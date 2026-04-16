package bridge

import (
	"context"
	"net"
	"os"
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

// SnapshotAll quiesces every active session's reader goroutine at a
// clean frame boundary, captures a snapshot, and extracts the TCP
// file descriptors. The reader goroutine blocks after producing the
// snapshot so it doesn't race with the child process on the socket.
func (b *Bridge) SnapshotAll() (*HandoffManifest, []*os.File, error) {
	b.sessionsMutex.Lock()
	defer b.sessionsMutex.Unlock()

	manifest := &HandoffManifest{
		QLinkMode: b.QLinkMode,
		ElkoHost:  b.elkoHost,
		Context:   b.Context,
	}
	var files []*os.File

	for _, sess := range b.Sessions {
		// Skip sessions whose goroutine has already exited.
		sess.closeMutex.Lock()
		dead := sess.doneClosed
		sess.closeMutex.Unlock()
		if dead {
			log.Debug().Str("session", sess.sessionID).
				Msg("Session already closed; skipping snapshot")
			continue
		}

		replyCh := make(chan *SessionSnapshot, 1)
		select {
		case sess.snapshotReq <- replyCh:
		default:
			log.Warn().Str("session", sess.sessionID).
				Msg("Cannot request snapshot (channel full or nil); skipping")
			continue
		}

		// Wait for the goroutine to produce the snapshot. Timeout
		// handles dead sessions whose goroutine exited but the channel
		// still exists — the send above succeeds on the buffered
		// channel but nobody reads the request.
		var snap *SessionSnapshot
		select {
		case snap = <-replyCh:
		case <-time.After(10 * time.Second):
			log.Warn().Str("session", sess.sessionID).
				Msg("Snapshot request timed out (goroutine likely dead); skipping")
			continue
		}
		if snap == nil {
			continue
		}

		// Now that the reader goroutine is paused, extract the fds.
		clientFile, err := connFile(sess.clientConn.conn)
		if err != nil {
			log.Warn().Err(err).Str("session", sess.sessionID).
				Msg("Cannot snapshot session (client fd); skipping")
			continue
		}
		elkoFile, err := connFile(sess.elkoConn)
		if err != nil {
			clientFile.Close()
			log.Warn().Err(err).Str("session", sess.sessionID).
				Msg("Cannot snapshot session (elko fd); skipping")
			continue
		}
		clientIdx := len(files)
		files = append(files, clientFile)
		elkoIdx := len(files)
		files = append(files, elkoFile)
		snap.ClientFdIndex = clientIdx
		snap.ElkoFdIndex = elkoIdx

		manifest.Sessions = append(manifest.Sessions, *snap)
		log.Info().Str("session", sess.sessionID).
			Str("avatar", sess.UserName).
			Msg("Session snapshotted for handoff")
	}

	return manifest, files, nil
}

// RestoreAll reconstructs sessions from a handoff manifest and the
// inherited extra file descriptors, registers them in b.Sessions, and
// starts their goroutines.
func (b *Bridge) RestoreAll(manifest *HandoffManifest, extraFiles []*os.File) error {
	for _, snap := range manifest.Sessions {
		if snap.ClientFdIndex >= len(extraFiles) || snap.ElkoFdIndex >= len(extraFiles) {
			log.Error().Str("session", snap.SessionID).
				Msg("fd index out of range; dropping session")
			continue
		}
		clientConn, err := net.FileConn(extraFiles[snap.ClientFdIndex])
		if err != nil {
			log.Error().Err(err).Str("session", snap.SessionID).
				Msg("Cannot reconstruct client conn; dropping session")
			continue
		}
		extraFiles[snap.ClientFdIndex].Close()

		elkoConn, err := net.FileConn(extraFiles[snap.ElkoFdIndex])
		if err != nil {
			clientConn.Close()
			log.Error().Err(err).Str("session", snap.SessionID).
				Msg("Cannot reconstruct elko conn; dropping session")
			continue
		}
		extraFiles[snap.ElkoFdIndex].Close()

		sess := RestoreSession(b, &snap, clientConn, elkoConn)
		b.Sessions[clientConn.RemoteAddr().String()] = sess
		observability.IncSessionsTotal(context.Background())
		observability.AddSessionActive(context.Background(), 1)
		sess.StartRestored()

		log.Info().Str("session", snap.SessionID).
			Str("avatar", snap.UserName).
			Msg("Session restored from handoff")
	}
	return nil
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
