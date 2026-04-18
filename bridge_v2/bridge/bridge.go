package bridge

import (
	"context"
	"net"
	"sync"
	"time"

	"github.com/frandallfarmer/neohabitat/bridge_v2/observability"
	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)


type Bridge struct {
	Context         string
	DataRate        int
	MongoClient     *mongo.Client
	MongoCollection *mongo.Collection
	MongoDatabase   *mongo.Database
	QLinkMode       bool
	Sessions        map[string]*ClientSession

	listener        net.Listener
	listenHost      string
	elkoHost        string
	mongoURL        string
	mongoCancelFunc context.CancelFunc
	mongoDatabase   string
	mongoCollection string
	mongoCtx        context.Context
	sessionsMutex   sync.Mutex
	wg              sync.WaitGroup
}

func (b *Bridge) Close() {
	log.Info().Msg("Closing bridge...")
	for _, session := range b.Sessions {
		session.log.Debug().Msg("Closing ClientSession")
		session.Close()
	}
	b.mongoCancelFunc()
	err := b.listener.Close()
	if err != nil {
		log.Error().Msgf("Could not close Bridge listener: %v", err)
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
	if b.listener == nil {
		log.Info().Msgf("Starting bridge listener at: %s", b.listenHost)
		b.listener, err = net.Listen("tcp", b.listenHost)
		if err != nil {
			log.Fatal().Msgf("Could not initialize TCP listener on %s: %v", b.listenHost, err)
			return
		}
	} else {
		log.Info().Msgf("Using inherited listener at: %s", b.listener.Addr())
	}
	for {
		conn, err := b.listener.Accept()
		if err != nil {
			log.Error().Msgf("Failed to accept TCP connection: %v", err)
			return
		} else {
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
}

// SetListener injects a listener managed by tableflip instead of
// having Run() create one via net.Listen. When set, Run() skips
// the listen call and uses this listener directly.
func (b *Bridge) SetListener(ln net.Listener) {
	b.listener = ln
}

// SnapshotAllWithTCP quiesces sessions and captures both application
// state and TCP connection state (via TCP_REPAIR getsockopt). The
// child process uses the TCP state to create brand new sockets —
// no fd inheritance, no epoll conflicts.
func (b *Bridge) SnapshotAllWithTCP(ln net.Listener) (*HandoffManifest, error) {
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

	// Phase 2: close the listener. This frees the port for bind()
	// in TCP_REPAIR restore. The child will reopen it with
	// SO_REUSEPORT after restoring connections.
	log.Info().Msg("Closing listener for TCP_REPAIR bind")
	ln.Close()

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

func NewBridge(
	context string,
	listenHost string,
	elkoHost string,
	mongoURL string,
	mongoDatabase string,
	mongoCollection string,
	dataRate int,
	qlinkMode bool,
) *Bridge {
	return &Bridge{
		Context:         context,
		DataRate:        dataRate,
		QLinkMode:       qlinkMode,
		Sessions:        make(map[string]*ClientSession),
		listenHost:      listenHost,
		elkoHost:        elkoHost,
		mongoURL:        mongoURL,
		mongoDatabase:   mongoDatabase,
		mongoCollection: mongoCollection,
	}
}
