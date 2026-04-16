package main

import (
	"context"
	"flag"
	"fmt"
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

	// If the parent left a snapshot file, restore sessions from it
	// before accepting new connections. The inherited fds are retrieved
	// by name via tableflip's Fds API — no raw fd arithmetic.
	if snapPath := os.Getenv(snapshotEnvVar); snapPath != "" {
		manifest, merr := bridge.ReadManifest(snapPath)
		if merr != nil {
			log.Error().Err(merr).Msg("Could not read handoff manifest; starting fresh")
		} else {
			var extraFiles []*os.File
			for i := range manifest.Sessions {
				cname := fmt.Sprintf("session-%d-client", i)
				ename := fmt.Sprintf("session-%d-elko", i)
				cf, cerr := upg.Fds.File(cname)
				ef, eerr := upg.Fds.File(ename)
				if cerr != nil || eerr != nil {
					log.Error().Int("index", i).
						AnErr("client_err", cerr).AnErr("elko_err", eerr).
						Msg("Cannot retrieve inherited fds for session; skipping")
					continue
				}
				extraFiles = append(extraFiles, cf, ef)
			}
			if rerr := habitatBridge.RestoreAll(manifest, extraFiles); rerr != nil {
				log.Error().Err(rerr).Msg("Session restore failed")
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

			manifest, files, serr := habitatBridge.SnapshotAll()
			if serr != nil {
				log.Error().Err(serr).Msg("Snapshot failed; aborting upgrade")
				continue
			}

			snapPath := filepath.Join(os.TempDir(), fmt.Sprintf("bridge_v2_handoff_%d.json", os.Getpid()))
			if werr := bridge.WriteManifest(snapPath, manifest); werr != nil {
				log.Error().Err(werr).Msg("Could not write manifest; aborting upgrade")
				for _, f := range files {
					f.Close()
				}
				continue
			}

			os.Setenv(snapshotEnvVar, snapPath)

			// Pass session fds to the child via tableflip's Fds mechanism.
			// Each session contributes two fds (client, elko) in order.
			for i := 0; i < len(files); i += 2 {
				sessIdx := i / 2
				upg.Fds.AddFile(fmt.Sprintf("session-%d-client", sessIdx), files[i])
				upg.Fds.AddFile(fmt.Sprintf("session-%d-elko", sessIdx), files[i+1])
			}

			if uerr := upg.Upgrade(); uerr != nil {
				log.Error().Err(uerr).Msg("Upgrade failed")
				os.Remove(snapPath)
				continue
			}

			// Close the parent's copies of the dup'd session fds so the
			// parent's goroutines (elkoReader, main loop) unblock from
			// their Read calls and exit. Without this, Close() hangs on
			// wg.Wait() because the goroutines keep reading from valid
			// dup'd fds, the parent process never exits, and the child's
			// next SIGHUP fails with "parent hasn't exited".
			for _, f := range files {
				f.Close()
			}

			log.Info().Int("sessions", len(manifest.Sessions)).
				Msg("Upgrade triggered; waiting for child to take over")
		}
	}()

	habitatBridge.Start()

	if err := upg.Ready(); err != nil {
		log.Fatal().Err(err).Msg("Could not signal readiness to parent")
	}

	// Wait for either SIGINT (hard shutdown) or tableflip telling us the
	// child is ready and we should exit.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	select {
	case <-sigCh:
		log.Info().Msg("Received SIGINT, shutting down...")
	case <-upg.Exit():
		log.Info().Msg("Child process ready; parent exiting...")
	}

	habitatBridge.Close()
	if otelShutdown != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := otelShutdown(shutdownCtx); err != nil {
			log.Error().Err(err).Msg("OpenTelemetry shutdown error")
		}
	}
}
