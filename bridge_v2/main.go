package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"time"

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

func main() {
	flag.Parse()
	setLogLevel(*logLevel)
	// When OTel is enabled, emit native zerolog JSON so Promtail/Loki can
	// extract structured fields (avatar, session_id, ip, level) as labels.
	// Otherwise use the pretty ConsoleWriter for local terminal readability.
	if !*otelEnabled {
		log.Logger = log.Output(zerolog.ConsoleWriter{
			Out:        os.Stderr,
			TimeFormat: "3:04:05PM",
			FormatTimestamp: func(i interface{}) string {
				return "\033[35m" + fmt.Sprintf("%s", i) + "\033[0m"
			},
		})
	}

	// OpenTelemetry init is opt-in via -otel.enabled. When disabled the
	// bridge runs against the SDK's noop tracer/meter providers, so all
	// the span/metric call sites in the bridge package are cheap branch-
	// predictable no-ops. Endpoint and credentials come from the standard
	// OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS env vars.
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
	habitatBridge.Start()
	intSignal := make(chan os.Signal, 1)
	signal.Notify(intSignal, os.Interrupt)
	<-intSignal
	log.Info().Msg("Received SIGINT, shutting down...")
	habitatBridge.Close()
	if otelShutdown != nil {
		// Bound the flush so a stuck collector can't keep the process
		// alive forever after SIGINT.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := otelShutdown(shutdownCtx); err != nil {
			log.Error().Err(err).Msg("OpenTelemetry shutdown error")
		}
	}
}
