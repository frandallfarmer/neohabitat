package bridge

import (
	"context"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/frandallfarmer/neohabitat/bridge_v2/observability"
	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/sys/unix"
)

type Bridge struct {
	Context          string
	DataRate         int
	MongoClient      *mongo.Client
	MongoCollection  *mongo.Collection
	MongoDatabase    *mongo.Database
	OriginalHatchery bool
	QLinkMode        bool
	Sessions         map[string]*ClientSession

	// listeners and listenAddrs are 1:1 by index. Multiple listeners
	// let one stateful bridge process serve multiple host ports
	// (1337/1986/2026 historically) without splitting session state
	// across processes — clients on different ports can still see each
	// other's avatars because they share the in-memory session map.
	listeners       []net.Listener
	listenAddrs     []string
	elkoHost        string
	mongoURL        string
	mongoCancelFunc context.CancelFunc
	mongoDatabase   string
	mongoCollection string
	mongoCtx        context.Context
	// acceptDone is closed once *every* per-listener accept goroutine
	// has exited. SnapshotAllWithTCP waits on this before TCP_REPAIR
	// bind, so all listener fds must be released first.
	acceptDone    chan struct{}
	acceptWg      sync.WaitGroup
	sessionsMutex sync.Mutex
	wg            sync.WaitGroup
}

func (b *Bridge) Close() {
	log.Info().Msg("Closing bridge...")
	for _, session := range b.Sessions {
		session.log.Debug().Msg("Closing ClientSession")
		session.Close()
	}
	b.mongoCancelFunc()
	for _, ln := range b.listeners {
		if ln == nil {
			continue
		}
		if err := ln.Close(); err != nil {
			log.Error().Err(err).Str("addr", ln.Addr().String()).Msg("Could not close Bridge listener")
		}
	}
	b.wg.Wait()
}

func (b *Bridge) RemoveSession(s *ClientSession) {
	b.sessionsMutex.Lock()
	defer b.sessionsMutex.Unlock()
	s.log.Debug().Msg("Removing ClientSession")
	delete(b.Sessions, s.TableKey())
	observability.AddSessionActive(context.Background(), -1)
}

func (b *Bridge) Run() {
	b.wg.Add(1)
	defer b.wg.Done()
	var err error
	b.MongoClient, err = mongo.NewClient(options.Client().ApplyURI(b.mongoURL))
	if err != nil {
		log.Fatal().Msgf("Could not initialize Mongo client at URL %s: %v", b.mongoURL, err)
		return
	}
	b.mongoCtx, b.mongoCancelFunc = context.WithCancel(context.Background())
	err = b.MongoClient.Connect(b.mongoCtx)
	if err != nil {
		log.Fatal().Msgf("Could not connect Mongo client at URL %s: %v", b.mongoURL, err)
		return
	}
	b.MongoDatabase = b.MongoClient.Database(b.mongoDatabase)
	b.MongoCollection = b.MongoDatabase.Collection(b.mongoCollection)
	// Elko reachability is a hard startup invariant: bridge_v2 has no
	// useful behavior without it, and surfacing the dependency here
	// gives a clean fast-fail (and a docker-compose restart) instead of
	// per-session DNS errors and follow-on nil derefs once clients
	// arrive. Use exponential backoff so a cold-start race against
	// Elko (both containers coming up together) doesn't immediately
	// kill us.
	const (
		elkoProbeInitial = 500 * time.Millisecond
		elkoProbeMax     = 30 * time.Second
		elkoProbeBudget  = 2 * time.Minute
	)
	deadline := time.Now().Add(elkoProbeBudget)
	delay := elkoProbeInitial
	for {
		probeConn, probeErr := net.DialTimeout("tcp", b.elkoHost, 5*time.Second)
		if probeErr == nil {
			_ = probeConn.Close()
			log.Info().Msgf("Elko reachable at: %s", b.elkoHost)
			break
		}
		if time.Now().After(deadline) {
			log.Fatal().Msgf("Could not reach Elko at %s within %s: %v",
				b.elkoHost, elkoProbeBudget, probeErr)
			return
		}
		log.Warn().Msgf("Elko probe failed (%v); retrying in %s", probeErr, delay)
		time.Sleep(delay)
		delay *= 2
		if delay > elkoProbeMax {
			delay = elkoProbeMax
		}
	}
	// Lazy-create any listeners not already injected by tableflip
	// (SetListeners). One listener per configured address; indexes match
	// b.listenAddrs so the log line and the /proc walk in
	// SnapshotAllWithTCP can correlate them.
	if len(b.listeners) < len(b.listenAddrs) {
		// Pad up to the number of configured addresses, then fill empties.
		newListeners := make([]net.Listener, len(b.listenAddrs))
		copy(newListeners, b.listeners)
		b.listeners = newListeners
	}
	for i, addr := range b.listenAddrs {
		if b.listeners[i] != nil {
			log.Info().Str("addr", b.listeners[i].Addr().String()).Msg("Using inherited listener")
			continue
		}
		log.Info().Str("addr", addr).Msg("Starting bridge listener")
		ln, lerr := net.Listen("tcp", addr)
		if lerr != nil {
			log.Fatal().Err(lerr).Str("addr", addr).Msg("Could not initialize TCP listener")
			return
		}
		b.listeners[i] = ln
	}

	// One Accept goroutine per listener. acceptDone fires once *all*
	// have exited, so SnapshotAllWithTCP can rely on the channel as a
	// "all listener fds released" signal.
	for _, ln := range b.listeners {
		ln := ln
		b.acceptWg.Add(1)
		go b.acceptLoop(ln)
	}
	go func() {
		b.acceptWg.Wait()
		close(b.acceptDone)
	}()
}

// acceptLoop runs Accept for a single listener. Spawned once per
// configured listen address by Run.
func (b *Bridge) acceptLoop(ln net.Listener) {
	defer b.acceptWg.Done()
	addr := ln.Addr().String()
	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Error().Err(err).Str("addr", addr).Msg("Failed to accept TCP connection")
			return
		}
		newSession := NewClientSession(b, NewClientConnection(b, conn))
		b.Sessions[conn.RemoteAddr().String()] = newSession
		// Increment the active-sessions gauge here rather than inside
		// NewClientSession so the counter only ticks for accepted
		// connections, not for synthetic sessions in tests.
		observability.IncSessionsTotal(context.Background())
		observability.AddSessionActive(context.Background(), 1)
		newSession.Start()
	}
}

// listenPorts returns the set of TCP ports the bridge is configured
// to listen on. Used by SnapshotAllWithTCP's /proc walk to find
// listener fds that need to be force-closed before TCP_REPAIR bind.
func (b *Bridge) listenPorts() map[int]struct{} {
	ports := make(map[int]struct{}, len(b.listenAddrs))
	for _, addr := range b.listenAddrs {
		_, portStr, perr := net.SplitHostPort(addr)
		if perr != nil {
			continue
		}
		if p, cerr := strconv.Atoi(portStr); cerr == nil {
			ports[p] = struct{}{}
		}
	}
	return ports
}

// SetListeners injects listeners managed by tableflip instead of
// having Run() create them via net.Listen. Order must match the
// configured listenAddrs so the addresses logged in Run line up with
// the actual sockets. Pass nil at any index to let Run() create that
// listener itself (mixed inherited/fresh is supported but not used in
// production today).
func (b *Bridge) SetListeners(listeners []net.Listener) {
	b.listeners = listeners
}

// SnapshotAllWithTCP quiesces sessions and captures both application
// state and TCP connection state (via TCP_REPAIR getsockopt). The
// child process uses the TCP state to create brand new sockets —
// no fd inheritance, no epoll conflicts.
//
// All configured listeners (b.listeners) are closed before TCP_REPAIR
// bind so the kernel releases each port. With multiple listeners we
// also walk /proc looking for *any* listening fd matching *any* of
// our listen ports — Go and tableflip can each hold dup'd fds for
// each listener.
func (b *Bridge) SnapshotAllWithTCP() (*HandoffManifest, error) {
	b.sessionsMutex.Lock()
	defer b.sessionsMutex.Unlock()

	manifest := &HandoffManifest{
		QLinkMode: b.QLinkMode,
		ElkoHost:  b.elkoHost,
		Context:   b.Context,
	}

	// Phase 1: quiesce all live sessions at frame boundaries.
	type quiescedSession struct {
		sess *ClientSession
		snap *SessionSnapshot
	}
	var quiesced []quiescedSession

	for _, sess := range b.Sessions {
		sess.closeMutex.Lock()
		dead := sess.doneClosed
		sess.closeMutex.Unlock()
		if dead {
			log.Debug().Str("session", sess.sessionID).
				Msg("Session already closed; skipping")
			continue
		}
		// JSON-passthrough sessions (the bots, web clients) don't
		// participate in the snapshotReq protocol — that path is wired
		// only into the binary handler loops (handleClientMessage and
		// runHabilink). Trying anyway just blocks for 10s per session
		// before timing out and landing in the same skip branch. Skip
		// them up front: they reconnect via shouldReconnect, while the
		// C64 binary sessions are the ones that actually need
		// TCP_REPAIR preservation across upgrades.
		if sess.jsonPassthrough {
			log.Debug().Str("session", sess.sessionID).
				Msg("Skipping snapshot (JSON passthrough — relies on client reconnect)")
			continue
		}
		if tc, ok := sess.clientConn.conn.(*net.TCPConn); ok {
			tc.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		}
		replyCh := make(chan *SessionSnapshot, 1)
		select {
		case sess.snapshotReq <- replyCh:
		default:
			log.Warn().Str("session", sess.sessionID).
				Msg("Cannot request snapshot; skipping")
			continue
		}
		var snap *SessionSnapshot
		select {
		case snap = <-replyCh:
		case <-time.After(10 * time.Second):
			log.Warn().Str("session", sess.sessionID).
				Msg("Snapshot timed out; skipping")
			continue
		}
		if snap != nil {
			quiesced = append(quiesced, quiescedSession{sess, snap})
		}
	}

	if len(quiesced) == 0 {
		return manifest, nil
	}

	// Phase 2: close every listener and wait for *all* Accept loops to
	// exit. Each Accept goroutine holds an incref on its listener fd;
	// until they all return, the kernel keeps the bind hash entries
	// and TCP_REPAIR bind fails with EADDRINUSE.
	for _, ln := range b.listeners {
		if ln == nil {
			continue
		}
		log.Info().Str("addr", ln.Addr().String()).Msg("Closing listener for TCP_REPAIR bind")
		ln.Close()
	}
	<-b.acceptDone
	// Go's Close and tableflip's Fds leave multiple dup'd fds for each
	// listener (one in Fds.used, one in the net.TCPListener). Closing
	// one doesn't release the bind because the other still references
	// the same kernel socket. Brute-force: walk /proc/self/fd once,
	// close every LISTEN socket whose port matches *any* of our
	// configured listen ports.
	ports := b.listenPorts()
	fdDir := fmt.Sprintf("/proc/%d/fd", os.Getpid())
	entries, _ := os.ReadDir(fdDir)
	for _, e := range entries {
		link, err := os.Readlink(fmt.Sprintf("%s/%s", fdDir, e.Name()))
		if err != nil || !strings.Contains(link, "socket:") {
			continue
		}
		var fdNum int
		fmt.Sscanf(e.Name(), "%d", &fdNum)
		// Check if this fd is a LISTEN socket on one of our ports.
		sa, gerr := unix.Getsockname(fdNum)
		if gerr != nil {
			continue
		}
		// SO_ACCEPTCONN is 1 for listening sockets, 0 for connected.
		isListen, _ := unix.GetsockoptInt(fdNum, unix.SOL_SOCKET, unix.SO_ACCEPTCONN)
		if isListen != 1 {
			continue
		}
		if sa4, ok := sa.(*unix.SockaddrInet4); ok {
			if _, match := ports[sa4.Port]; match {
				log.Info().Int("fd", fdNum).Int("port", sa4.Port).Msg("Force-closing listener fd")
				unix.Close(fdNum)
			}
		}
		if sa6, ok := sa.(*unix.SockaddrInet6); ok {
			if _, match := ports[sa6.Port]; match {
				log.Info().Int("fd", fdNum).Int("port", sa6.Port).Msg("Force-closing listener fd (v6)")
				unix.Close(fdNum)
			}
		}
	}
	log.Info().Msg("All listener fds closed")

	// Phase 3: save + restore each session's client TCP connection.
	for _, qs := range quiesced {
		clientTCP, clientFd, err := SaveAndRestoreTCPConn(qs.sess.clientConn.conn)
		if err != nil {
			log.Error().Err(err).Str("session", qs.sess.sessionID).
				Msg("Cannot save+restore client TCP; skipping")
			continue
		}
		qs.snap.ClientTCP = clientTCP
		qs.snap.restoredClientFd = clientFd
		// Verify the restored socket is actually connected
		if psa, perr := unix.Getpeername(clientFd); perr != nil {
			log.Error().Err(perr).Int("fd", clientFd).
				Msg("Restored fd has no peer — socket not ESTABLISHED")
		} else {
			if p4, ok := psa.(*unix.SockaddrInet4); ok {
				log.Info().Int("fd", clientFd).
					Int("port", p4.Port).
					Msg("Restored fd peer verified")
			}
		}
		_ = qs.sess.elkoConn.Close()
		manifest.Sessions = append(manifest.Sessions, *qs.snap)
		log.Info().Str("session", qs.sess.sessionID).
			Str("avatar", qs.sess.UserName).
			Uint32("snd_seq", clientTCP.SndSeq).
			Uint32("rcv_seq", clientTCP.RcvSeq).
			Msg("Session snapshotted with TCP state")
	}

	return manifest, nil
}

// RegisterRestoredSession adds a restored session to the bridge's
// session map and increments counters.
func (b *Bridge) RegisterRestoredSession(sess *ClientSession) {
	b.sessionsMutex.Lock()
	defer b.sessionsMutex.Unlock()
	b.Sessions[sess.TableKey()] = sess
	observability.IncSessionsTotal(context.Background())
	observability.AddSessionActive(context.Background(), 1)
}

// WaitForSessions blocks until all active sessions have closed
// naturally. Used during graceful upgrade — old sessions drain on
// the old process while the child handles new connections.
func (b *Bridge) WaitForSessions() {
	for {
		b.sessionsMutex.Lock()
		n := len(b.Sessions)
		b.sessionsMutex.Unlock()
		if n == 0 {
			return
		}
		log.Info().Int("remaining", n).Msg("Waiting for sessions to drain")
		time.Sleep(2 * time.Second)
	}
}

func (b *Bridge) Start() {
	go b.Run()
}

// NewBridge constructs a Bridge configured to listen on one or more
// addresses. Pass at least one address — main.go validates this.
func NewBridge(
	context string,
	listenAddrs []string,
	elkoHost string,
	mongoURL string,
	mongoDatabase string,
	mongoCollection string,
	dataRate int,
	qlinkMode bool,
) *Bridge {
	// Defensive copy so the caller's slice can't mutate ours later.
	addrs := append([]string(nil), listenAddrs...)
	return &Bridge{
		Context:          context,
		DataRate:         dataRate,
		OriginalHatchery: originalHatcheryEnabled(),
		QLinkMode:        qlinkMode,
		Sessions:         make(map[string]*ClientSession),
		acceptDone:       make(chan struct{}),
		listenAddrs:      addrs,
		elkoHost:         elkoHost,
		mongoURL:         mongoURL,
		mongoDatabase:    mongoDatabase,
		mongoCollection:  mongoCollection,
	}
}

func originalHatcheryEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("NEOHABITAT_ORIGINAL_HATCHERY"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
