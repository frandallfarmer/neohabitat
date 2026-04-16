package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"net"
	"syscall"
	"time"

	"github.com/cloudflare/tableflip"
	"github.com/frandallfarmer/neohabitat/bridge_v2/bridge"
	"github.com/frandallfarmer/neohabitat/bridge_v2/observability"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// buildVersion is overridable at link time:
//
//	go build -ldflags "-X main.buildVersion=$(git rev-parse --short HEAD)" ./...
//
// It's reported to OTel as service.version so traces and metrics tag
// the build that produced them. Defaults to "dev" for local Air rebuilds.
var buildVersion = "dev"

var initialContext = flag.String("context", "context-Downtown_5f", "Parameter for entercontext for unknown users")
var listen = flag.String("listen", "127.0.0.1:1337", "Host:Port to listen for client connections")
// Default target is Habiproxy (pushserver's TCP session-tracking proxy on
// port 2018), not Elko directly on 9000. Habiproxy parses messages in-
// flight to extract avatar location and region state, then fires callbacks
// to pushserver's HTTP tier so the web Docent UI can render region help,
// avatar lists, and compass state alongside a live C64 session. Pointing
// at 9000 bypasses the Docent entirely. See pushserver/habiproxy/proxy.js
// and pushserver/routes/events.js for the proxy → Docent event plumbing.
var elko = flag.String("elko.host", "127.0.0.1:2018", "Host:Port of Habiproxy (or Elko directly — but Habiproxy is required for Docent integration)")
var mongo = flag.String("mongo.host", "mongodb://127.0.0.1:27017", "MongoDB server host")
var mongoDatabase = flag.String("mongo.db", "elko", "Database within MongoDB to use")
var mongoCollection = flag.String("mongo.collection", "odb", "Collection within MongoDB to use")
var rate = flag.Int("rate", 1200, "Data rate in bits-per-second for transmitting to C64 clients")
var logLevel = flag.String("log.level", "INFO", "Log level for logger")
var qlinkMode = flag.Bool("qlink", false, "Listen for Habilink/QLink clients (JSON name preamble + QLink wire protocol) instead of the legacy colon-prefix protocol")
var otelEnabled = flag.Bool("otel.enabled", false, "Enable OpenTelemetry export. Reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS from the environment.")

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

const snapshotEnvVar = "BRIDGE_SNAPSHOT_PATH"

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

	// tableflip manages the HAProxy-style graceful restart dance:
	//   - On first launch it creates a fresh listener.
	//   - On SIGHUP it forks a child, passes the listener fd (and any
	//     extra session fds), and waits for the child to signal Ready.
	//   - The parent then drains existing work and exits.
	upg, err := tableflip.New(tableflip.Options{})
	if err != nil {
		log.Fatal().Err(err).Msg("Could not initialize tableflip upgrader")
	}
	defer upg.Stop()

	ln, err := upg.Listen("tcp", *listen)
	if err != nil {
		log.Fatal().Err(err).Str("addr", *listen).Msg("Could not obtain listener")
	}

	habitatBridge := bridge.NewBridge(
		*initialContext,
		*listen,
		*elko,
		*mongo,
		*mongoDatabase,
		*mongoCollection,
		*rate,
		*qlinkMode,
	)
	habitatBridge.SetListener(ln)

	// If the parent left a snapshot file, restore sessions from it.
	// Inherited connections are retrieved by name via tableflip's
	// Fds.Conn API — SyscallConn-based, no blocking mode issues.
	if snapPath := os.Getenv(snapshotEnvVar); snapPath != "" {
		manifest, merr := bridge.ReadManifest(snapPath)
		if merr != nil {
			log.Error().Err(merr).Msg("Could not read handoff manifest; starting fresh")
		} else {
			for _, snap := range manifest.Sessions {
				cc, cerr := fileToConn(upg, "client-"+snap.SessionID)
				ec, eerr := fileToConn(upg, "elko-"+snap.SessionID)
				if cerr != nil || eerr != nil || cc == nil || ec == nil {
					log.Error().Str("session", snap.SessionID).
						AnErr("client_err", cerr).AnErr("elko_err", eerr).
						Msg("Cannot retrieve inherited conns; skipping")
					continue
				}
				sess := bridge.RestoreSession(habitatBridge, &snap, cc, ec)
				habitatBridge.RegisterRestoredSession(sess)
				sess.StartRestored()
				log.Info().Str("session", snap.SessionID).
					Str("avatar", snap.UserName).
					Msg("Session restored from handoff")
			}
			os.Remove(snapPath)
		}
	}

	// SIGHUP triggers a graceful upgrade: snapshot sessions, fork child
	// with inherited fds, let child take over.
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGHUP)
		for range sig {
			log.Info().Msg("SIGHUP received, starting graceful upgrade...")

			manifest, sessConns, serr := habitatBridge.SnapshotAll()
			if serr != nil {
				log.Error().Err(serr).Msg("Snapshot failed; aborting upgrade")
				continue
			}

			snapPath := filepath.Join(os.TempDir(), fmt.Sprintf("bridge_v2_handoff_%d.json", os.Getpid()))
			if werr := bridge.WriteManifest(snapPath, manifest); werr != nil {
				log.Error().Err(werr).Msg("Could not write manifest; aborting upgrade")
				continue
			}

			os.Setenv(snapshotEnvVar, snapPath)

			// Use AddFile (not AddConn) so we can close the inherited
			// *os.File in the child after net.FileConn dups it. AddConn
			// keeps the file alive in Fds.used which competes with the
			// net.Conn for Go's poller notifications on the same socket.
			for sessID, sc := range sessConns {
				if err := upg.Fds.AddFile("client-"+sessID, connToFile(sc.ClientConn)); err != nil {
					log.Error().Err(err).Str("session", sessID).Msg("AddFile failed for client")
				}
				if err := upg.Fds.AddFile("elko-"+sessID, connToFile(sc.ElkoConn)); err != nil {
					log.Error().Err(err).Str("session", sessID).Msg("AddFile failed for elko")
				}
			}

			if uerr := upg.Upgrade(); uerr != nil {
				log.Error().Err(uerr).Msg("Upgrade failed")
				os.Remove(snapPath)
				continue
			}

			log.Info().Int("sessions", len(manifest.Sessions)).
				Msg("Upgrade triggered; waiting for child to take over")
		}
	}()

	habitatBridge.Start()

	if err := upg.Ready(); err != nil {
		log.Fatal().Err(err).Msg("Could not signal readiness to parent")
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	select {
	case <-sigCh:
		log.Info().Msg("Received SIGINT, shutting down...")
		habitatBridge.Close()
		if otelShutdown != nil {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := otelShutdown(shutdownCtx); err != nil {
				log.Error().Err(err).Msg("OpenTelemetry shutdown error")
			}
		}
	case <-upg.Exit():
		// Child has taken over. Return from main so defer upg.Stop()
		// runs tableflip's cleanup protocol. Don't call
		// habitatBridge.Close() — File() put connections in blocking
		// mode and Close can't unblock those goroutines. The process
		// exit reclaims everything; the child's inherited fds survive.
		log.Info().Msg("Child process ready; parent exiting")
	}
}

// connToFile wraps a net.Conn's fd in an *os.File via SyscallConn so
// AddFile can dup it without calling File() (which switches the conn
// to blocking mode). The returned *os.File shares the fd with the
// conn — don't close it while the conn is in use.
func connToFile(c net.Conn) *os.File {
	sc, ok := c.(syscall.Conn)
	if !ok {
		return nil
	}
	raw, err := sc.SyscallConn()
	if err != nil {
		return nil
	}
	var fd uintptr
	raw.Control(func(f uintptr) { fd = f })
	return os.NewFile(fd, "conn")
}

// fileToConn retrieves an inherited file by name from the tableflip
// upgrader, converts it to a net.Conn via net.FileConn, then closes
// the *os.File so its fd is deregistered from Go's poller. The
// net.Conn has its own dup'd fd and is the sole poller registrant for
// the socket — no competition for read notifications.
func fileToConn(upg *tableflip.Upgrader, name string) (net.Conn, error) {
	f, err := upg.Fds.File(name)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, fmt.Errorf("inherited file %q not found", name)
	}
	conn, err := net.FileConn(f)
	f.Close()
	if err != nil {
		return nil, fmt.Errorf("FileConn(%s): %w", name, err)
	}
	return conn, nil
}
