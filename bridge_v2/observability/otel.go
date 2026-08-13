// Package observability sets up OpenTelemetry tracer + meter providers
// configured to export over OTLP/HTTP. The exporter endpoint and
// credentials come from the standard OTEL_EXPORTER_OTLP_* env vars
// (the SDK reads them automatically), so no app-level config plumbing
// for the URL or headers is required. Grafana Cloud expects:
//
//	OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-...grafana.net/otlp
//	OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceID:token)>
//
// When OTel is disabled (the default), this package is not initialized
// and the rest of the codebase falls through to the noop tracer/meter
// providers shipped with the SDK — span and metric calls become
// branch-predictable no-ops.
package observability

import (
	"context"
	"fmt"

	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	// MUST track the semconv version that sdk/resource itself imports —
	// resource.Merge refuses to merge two resources with conflicting schema
	// URLs, so a mismatch here is a FATAL error at startup, not a warning.
	// otel sdk 1.45.0 moved resource.Default() from schema 1.41.0 to 1.43.0.
	// See buildResource and TestBuildResource.
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

// semconvSchemaURL is the schema URL of the semconv package imported above.
// Named here so the drift test checks the SAME import production code uses,
// rather than importing semconv a second time and drifting independently.
const semconvSchemaURL = semconv.SchemaURL

// buildResource merges the SDK's default resource with our service identity.
//
// Split out of Init purely so it can be tested without a collector: this is the
// one part of OTel setup that can fail on a plain dependency bump, and Init as a
// whole needs a live OTLP endpoint to run.
func buildResource(serviceName, version string) (*resource.Resource, error) {
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String(serviceName),
			semconv.ServiceVersionKey.String(version),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("build resource: %w", err)
	}
	return res, nil
}

// Init wires up the global tracer and meter providers and starts the
// Go runtime metrics collector. The returned shutdown function flushes
// both providers and should be called from the SIGINT path before
// process exit so in-flight spans and metric data points reach the
// collector.
func Init(ctx context.Context, serviceName, version string) (func(context.Context) error, error) {
	res, err := buildResource(serviceName, version)
	if err != nil {
		return nil, err
	}

	traceExp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("create OTLP trace exporter: %w", err)
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	metricExp, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("create OTLP metric exporter: %w", err)
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp)),
		sdkmetric.WithResource(res),
	)
	otel.SetMeterProvider(mp)

	if err := InitInstruments(); err != nil {
		return nil, fmt.Errorf("init instruments: %w", err)
	}

	if err := runtime.Start(); err != nil {
		return nil, fmt.Errorf("start runtime metrics: %w", err)
	}

	shutdown := func(ctx context.Context) error {
		var firstErr error
		if err := tp.Shutdown(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
		if err := mp.Shutdown(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
		return firstErr
	}
	return shutdown, nil
}
