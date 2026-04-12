package observability

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const instrumentationScope = "github.com/frandallfarmer/neohabitat/bridge_v2"

// Tracer is the package-wide tracer used by the bridge for session and
// Elko round-trip spans. Initialized eagerly via the global TracerProvider
// (which is a noop until Init runs), so callers can dereference it from
// process start without nil checks.
var Tracer trace.Tracer = otel.Tracer(instrumentationScope)

// Process-wide metric instruments. The package-level helpers below are
// nil-safe, so call sites in the bridge package don't have to repeatedly
// check whether OTel was enabled at startup. Until InitInstruments runs,
// these are nil and the helpers short-circuit.
var (
	SessionsActive metric.Int64UpDownCounter
	SessionsTotal  metric.Int64Counter
	MessagesIn     metric.Int64Counter
	MessagesOut    metric.Int64Counter
	ElkoRoundTrip  metric.Float64Histogram
	MongoQueryTime metric.Float64Histogram
)

// Attribute key constants used as both span attributes and zerolog
// structured-log field names so a trace and its surrounding logs share
// keys for indexing in Grafana Cloud.
const (
	AttrAvatar    = "avatar"
	AttrIP        = "ip"
	AttrSessionID = "session_id"
	AttrOp        = "op"
	AttrPeer      = "peer" // "client" | "elko"
)

// Span attribute helpers — typed at the call site so a typo at a span
// instrumentation point fails to compile rather than silently shipping
// the wrong key into Tempo.
func AvatarAttr(name string) attribute.KeyValue  { return attribute.String(AttrAvatar, name) }
func IPAttr(addr string) attribute.KeyValue      { return attribute.String(AttrIP, addr) }
func SessionIDAttr(id string) attribute.KeyValue { return attribute.String(AttrSessionID, id) }
func OpAttr(op string) attribute.KeyValue        { return attribute.String(AttrOp, op) }
func PeerAttr(p string) attribute.KeyValue       { return attribute.String(AttrPeer, p) }

// InitInstruments creates the process-wide metric instruments off the
// current global meter provider. Called once from Init after the OTLP
// meter provider is installed.
func InitInstruments() error {
	meter := otel.Meter(instrumentationScope)
	var err error

	SessionsActive, err = meter.Int64UpDownCounter(
		"bridge_v2.sessions.active",
		metric.WithDescription("Currently-connected client sessions"),
	)
	if err != nil {
		return fmt.Errorf("sessions.active: %w", err)
	}

	SessionsTotal, err = meter.Int64Counter(
		"bridge_v2.sessions.total",
		metric.WithDescription("Total client sessions accepted since process start"),
	)
	if err != nil {
		return fmt.Errorf("sessions.total: %w", err)
	}

	MessagesIn, err = meter.Int64Counter(
		"bridge_v2.messages.in",
		metric.WithDescription("Messages received from a peer (client or Elko)"),
	)
	if err != nil {
		return fmt.Errorf("messages.in: %w", err)
	}

	MessagesOut, err = meter.Int64Counter(
		"bridge_v2.messages.out",
		metric.WithDescription("Messages sent to a peer (client or Elko)"),
	)
	if err != nil {
		return fmt.Errorf("messages.out: %w", err)
	}

	ElkoRoundTrip, err = meter.Float64Histogram(
		"bridge_v2.elko.round_trip.seconds",
		metric.WithDescription("End-to-end latency of Elko request/reply pairs"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return fmt.Errorf("elko.round_trip: %w", err)
	}

	MongoQueryTime, err = meter.Float64Histogram(
		"bridge_v2.mongo.query.seconds",
		metric.WithDescription("Mongo query execution time"),
		metric.WithUnit("s"),
	)
	if err != nil {
		return fmt.Errorf("mongo.query: %w", err)
	}

	return nil
}

// Nil-safe metric helpers. The cost of an interface == nil check is
// negligible vs forcing every call site to branch on a global flag.

func AddSessionActive(ctx context.Context, delta int64, attrs ...attribute.KeyValue) {
	if SessionsActive == nil {
		return
	}
	SessionsActive.Add(ctx, delta, metric.WithAttributes(attrs...))
}

func IncSessionsTotal(ctx context.Context, attrs ...attribute.KeyValue) {
	if SessionsTotal == nil {
		return
	}
	SessionsTotal.Add(ctx, 1, metric.WithAttributes(attrs...))
}

func IncMessagesIn(ctx context.Context, attrs ...attribute.KeyValue) {
	if MessagesIn == nil {
		return
	}
	MessagesIn.Add(ctx, 1, metric.WithAttributes(attrs...))
}

func IncMessagesOut(ctx context.Context, attrs ...attribute.KeyValue) {
	if MessagesOut == nil {
		return
	}
	MessagesOut.Add(ctx, 1, metric.WithAttributes(attrs...))
}

func RecordElkoRoundTrip(ctx context.Context, seconds float64, attrs ...attribute.KeyValue) {
	if ElkoRoundTrip == nil {
		return
	}
	ElkoRoundTrip.Record(ctx, seconds, metric.WithAttributes(attrs...))
}

func RecordMongoQuery(ctx context.Context, seconds float64, attrs ...attribute.KeyValue) {
	if MongoQueryTime == nil {
		return
	}
	MongoQueryTime.Record(ctx, seconds, metric.WithAttributes(attrs...))
}
