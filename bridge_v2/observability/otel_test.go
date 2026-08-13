package observability

import (
	"strings"
	"testing"

	"go.opentelemetry.io/otel/sdk/resource"
)

// An otel bump that moves resource.Default()'s schema URL away from the semconv
// package this file imports makes resource.Merge fail, and Init() treats that as
// fatal — the bridge exits 1 on startup.
//
// That is exactly what otel 1.45.0 did: sdk/resource moved from semconv v1.41.0
// to v1.43.0 while this package still imported v1.41.0. Nothing caught it. The
// build was clean, vet was clean, every existing test passed, and the image built
// — because no test and no smoke path ever ran the --otel.enabled branch. It only
// surfaced when the deployed binary refused to start in production.
//
// So: exercise the merge directly. It needs no collector and no network.
func TestBuildResource(t *testing.T) {
	res, err := buildResource("bridge_v2", "test")
	if err != nil {
		t.Fatalf("buildResource failed — this is the startup-fatal path.\n"+
			"If this says \"conflicting Schema URL\", the semconv import in otel.go has\n"+
			"drifted from the one sdk/resource uses; realign it with the SDK.\nerror: %v", err)
	}

	// A conflicting merge can also silently yield an empty schema URL rather than
	// an error, which would ship a resource the collector can't attribute.
	if res.SchemaURL() == "" {
		t.Error("merged resource has an empty schema URL")
	}
	if want := resource.Default().SchemaURL(); res.SchemaURL() != want {
		t.Errorf("merged schema URL = %q, want %q (the SDK default)", res.SchemaURL(), want)
	}

	attrs := res.Attributes()
	found := map[string]string{}
	for _, kv := range attrs {
		found[string(kv.Key)] = kv.Value.Emit()
	}
	if found["service.name"] != "bridge_v2" {
		t.Errorf("service.name = %q, want %q", found["service.name"], "bridge_v2")
	}
	if found["service.version"] != "test" {
		t.Errorf("service.version = %q, want %q", found["service.version"], "test")
	}
}

// The schema URL our semconv import declares must be the SDK's, stated as a
// standalone check so a failure names the drift directly instead of surfacing as
// a confusing merge error.
func TestSemconvMatchesSDKResource(t *testing.T) {
	sdkURL := resource.Default().SchemaURL()
	ours := resource.NewWithAttributes(semconvSchemaURL)
	if ours.SchemaURL() != sdkURL {
		t.Fatalf("semconv drift: observability/otel.go imports schema %q but\n"+
			"go.opentelemetry.io/otel/sdk/resource uses %q.\n"+
			"Update the semconv import in otel.go to match the SDK.",
			ours.SchemaURL(), sdkURL)
	}
	if !strings.HasPrefix(sdkURL, "https://opentelemetry.io/schemas/") {
		t.Errorf("unexpected schema URL form: %q", sdkURL)
	}
}
