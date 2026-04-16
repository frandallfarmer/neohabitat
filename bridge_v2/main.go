package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
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

	upg, err := tableflip.New(tableflip.Options{})
	if err != nil {
		log.Fatal().Err(err).Msg("Could not initialize tableflip upgrader")
	}
	defer upg.Stop()

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGHUP)
		for range sig {
			log.Info().Msg("SIGHUP received, starting graceful upgrade...")
			if err := upg.Upgrade(); err != nil {
				log.Error().Err(err).Msg("Upgrade failed")
			}
		}
	}()

	ln, err := upg.Fds.Listen("tcp", *listen)
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
		if otelShutdown != nil {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := otelShutdown(shutdownCtx); err != nil {
				log.Error().Err(err).Msg("OpenTelemetry shutdown error")
			}
		}
	case <-upg.Exit():
		log.Info().Msg("Child process ready; draining existing sessions")
		// Old sessions stay on this process until they naturally close.
		// New connections go to the child via the inherited listener.
		// Wait for all sessions to finish, then exit.
		habitatBridge.WaitForSessions()
		log.Info().Msg("All sessions drained; exiting")
	}
}
