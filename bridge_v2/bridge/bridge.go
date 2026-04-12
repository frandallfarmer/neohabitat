package bridge

import (
	"context"
	"github.com/frandallfarmer/neohabitat/bridge_v2/observability"
	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"net"
	"sync"
	"time"
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
	log.Info().Msgf("Starting bridge listener at: %s", b.listenHost)
	b.listener, err = net.Listen("tcp", b.listenHost)
	if err != nil {
		log.Fatal().Msgf("Could not initialize TCP listener on %s: %v", b.listenHost, err)
		return
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
