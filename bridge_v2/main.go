package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/cloudflare/tableflip"
	"github.com/frandallfarmer/neohabitat/bridge_v2/bridge"
	"github.com/frandallfarmer/neohabitat/bridge_v2/observability"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var buildVersion = "dev"

var initialContext = flag.String("context", "context-Downtown_5f", "Parameter for entercontext for unknown users")
var listen = flag.String("listen", "127.0.0.1:1337", "Host:Port to listen for client connections")
var elko = flag.String("elko.host", "127.0.0.1:2018", "Host:Port of Habiproxy (or Elko directly — but Habiproxy is required for Docent integration)")
var mongo = flag.String("mongo.host", "mongodb://127.0.0.1:27017", "MongoDB server host")
var mongoDatabase = flag.String("mongo.db", "elko", "Database within MongoDB to use")
var mongoCollection = flag.String("mongo.collection", "odb", "Collection within MongoDB to use")
var rate = flag.Int("rate", 1200, "Data rate in bits-per-second for transmitting to C64 clients")
var logLevel = flag.String("log.level", "INFO", "Log level for logger")
var qlinkMode = flag.Bool("qlink", false, "Listen for Habilink/QLink clients (JSON name preamble + QLink wire protocol) instead of the legacy colon-prefix protocol")
var otelEnabled = flag.Bool("otel.enabled", false, "Enable OpenTelemetry export. Reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS from the environment.")
var graceful = flag.Bool("graceful", false, "Enable graceful restart via SIGHUP (tableflip). Incompatible with Air — use in production only.")

const snapshotEnvVar = "BRIDGE_SNAPSHOT_PATH"

func setLogLevel(level string) {
	switch lowerLevel := strings.ToLower(level); lowerLevel {
	case "info":
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	case "debug":
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	case "error":
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	case "warn":
		zerolog.SetGlobalLevel(zerolog.WarnLevel)
	case "trace":
		zerolog.SetGlobalLevel(zerolog.TraceLevel)
	default:
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	}
}

func main() {
	flag.Parse()
	setLogLevel(*logLevel)
	if !*otelEnabled {
		log.Logger = log.Output(zerolog.ConsoleWriter{
			Out:        os.Stderr,
			TimeFormat: "3:04:05PM",
			FormatTimestamp: func(i interface{}) string {
				return "\033[35m" + fmt.Sprintf("%s", i) + "\033[0m"
			},
		})
	}

	var otelShutdown func(context.Context) error
	if *otelEnabled {
		ctx := context.Background()
		var err error
		otelShutdown, err = observability.Init(ctx, "bridge_v2", buildVersion)
		if err != nil {
			log.Fatal().Err(err).Msg("Could not initialize OpenTelemetry")
		}
		log.Info().Str("version", buildVersion).Msg("OpenTelemetry initialized")
	}

	if *graceful {
		runWithTableflip(otelShutdown)
	} else {
		runSimple(otelShutdown)
	}
}

func runSimple(otelShutdown func(context.Context) error) {
	habitatBridge := bridge.NewBridge(
		*initialContext, *listen, *elko, *mongo,
		*mongoDatabase, *mongoCollection, *rate, *qlinkMode,
	)
	habitatBridge.Start()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh
	log.Info().Msg("Received SIGINT, shutting down...")
	habitatBridge.Close()
	shutdownOtel(otelShutdown)
}

func runWithTableflip(otelShutdown func(context.Context) error) {
	upg, err := tableflip.New(tableflip.Options{})
	if err != nil {
		log.Fatal().Err(err).Msg("Could not initialize tableflip upgrader")
	}
	defer upg.Stop()

	ln, err := upg.Fds.Listen("tcp", *listen)
	if err != nil {
		log.Fatal().Err(err).Str("addr", *listen).Msg("Could not obtain listener")
	}

	habitatBridge := bridge.NewBridge(
		*initialContext, *listen, *elko, *mongo,
		*mongoDatabase, *mongoCollection, *rate, *qlinkMode,
	)
	habitatBridge.SetListener(ln)

	// If the parent left a snapshot, restore sessions via TCP_REPAIR.
	// Brand new sockets with injected TCP state — no fd inheritance,
	// no epoll conflicts.
	if snapPath := os.Getenv(snapshotEnvVar); snapPath != "" {
		manifest, merr := bridge.ReadManifest(snapPath)
		if merr != nil {
			log.Error().Err(merr).Msg("Could not read manifest; starting fresh")
		} else {
			for _, snap := range manifest.Sessions {
				// Client connection: retrieve the fd passed by the parent
				// via AddFile. The parent did SaveAndRestore in its own
				// process (no bind race), then passed the blocking-mode fd.
				// We wrap it in net.Conn here (sets non-blocking, registers
				// with epoll — single registration, no conflicts).
				f, ferr := upg.Fds.File("client-" + snap.SessionID)
				if ferr != nil || f == nil {
					log.Error().AnErr("err", ferr).Str("session", snap.SessionID).
						Msg("Cannot retrieve client fd; skipping")
					continue
				}
				cc, cerr := net.FileConn(f)
				f.Close()
				if cerr != nil {
					log.Error().Err(cerr).Str("session", snap.SessionID).
						Msg("Cannot wrap client fd; skipping")
					continue
				}
				// Elko: fresh connection + re-enter context.
				ec, eerr := net.DialTimeout("tcp", *elko, 5*time.Second)
				if eerr != nil {
					cc.Close()
					log.Error().Err(eerr).Str("session", snap.SessionID).
						Msg("Cannot connect to Elko; skipping")
					continue
				}
				sess := bridge.RestoreSession(habitatBridge, &snap, cc, ec)
				habitatBridge.RegisterRestoredSession(sess)
				sess.StartRestored()
				log.Info().Str("session", snap.SessionID).
					Str("avatar", snap.UserName).
					Msg("Session restored via TCP_REPAIR")
			}
			os.Remove(snapPath)
		}
	}

	// SIGHUP: snapshot sessions with TCP state, then upgrade
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGHUP)
		for range sig {
			log.Info().Msg("SIGHUP received, starting graceful upgrade...")

			manifest, serr := habitatBridge.SnapshotAllWithTCP()
			if serr != nil {
				log.Error().Err(serr).Msg("Snapshot failed; aborting upgrade")
				continue
			}

			snapPath := filepath.Join(os.TempDir(),
				fmt.Sprintf("bridge_v2_handoff_%d.json", os.Getpid()))
			if werr := bridge.WriteManifest(snapPath, manifest); werr != nil {
				log.Error().Err(werr).Msg("Could not write manifest")
				continue
			}
			os.Setenv(snapshotEnvVar, snapPath)

			// Pass the restored client fds (blocking mode) via AddFile.
			// The parent did save+restore in its own process so the
			// sockets are already in ESTABLISHED state with correct
			// TCP sequence numbers. The child just wraps them.
			for _, snap := range manifest.Sessions {
				fd := snap.RestoredClientFd()
				if fd < 0 {
					continue
				}
				f := os.NewFile(uintptr(fd), "client-"+snap.SessionID)
				if err := upg.Fds.AddFile("client-"+snap.SessionID, f); err != nil {
					log.Error().Err(err).Str("session", snap.SessionID).
						Msg("AddFile failed for restored client fd")
				}
				f.Close()
			}

			if uerr := upg.Upgrade(); uerr != nil {
				log.Error().Err(uerr).Msg("Upgrade failed")
				os.Remove(snapPath)
				continue
			}

			log.Info().Int("sessions", len(manifest.Sessions)).
				Msg("Upgrade triggered; child will restore via TCP_REPAIR")
		}
	}()

	habitatBridge.Start()

	log.Info().Msg("Ready")
	if err := upg.Ready(); err != nil {
		log.Fatal().Err(err).Msg("Could not signal readiness to parent")
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	select {
	case <-sigCh:
		log.Info().Msg("Received SIGINT, shutting down...")
		habitatBridge.Close()
		shutdownOtel(otelShutdown)
	case <-upg.Exit():
		// Parent exits immediately — the child has already restored
		// all sessions via TCP_REPAIR on brand new sockets. No drain
		// needed.
		log.Info().Msg("Child restored sessions; parent exiting")
	}
}

func shutdownOtel(shutdown func(context.Context) error) {
	if shutdown != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdown(ctx); err != nil {
			log.Error().Err(err).Msg("OpenTelemetry shutdown error")
		}
	}
}

