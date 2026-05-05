package main

import "testing"

// stringSliceFlag is what wires --listen up multiple times. The Set
// method has to append, not overwrite — flag.Var calls Set once per
// occurrence, so a clobbering Set would silently drop ports.
func TestStringSliceFlag_AccumulatesRepeatedSet(t *testing.T) {
	var s stringSliceFlag
	for _, v := range []string{"0.0.0.0:1337", "0.0.0.0:1986", "0.0.0.0:2026"} {
		if err := s.Set(v); err != nil {
			t.Fatalf("Set(%q): %v", v, err)
		}
	}
	if len(s) != 3 {
		t.Fatalf("len(s) = %d, want 3 (entries: %v)", len(s), s)
	}
	want := []string{"0.0.0.0:1337", "0.0.0.0:1986", "0.0.0.0:2026"}
	for i, w := range want {
		if s[i] != w {
			t.Errorf("s[%d] = %q, want %q", i, s[i], w)
		}
	}
}

// String() is what flag.PrintDefaults shows; verify it doesn't panic
// on empty and joins with commas otherwise.
func TestStringSliceFlag_String(t *testing.T) {
	var s stringSliceFlag
	if got := s.String(); got != "" {
		t.Errorf("empty stringSliceFlag.String() = %q, want \"\"", got)
	}
	s = stringSliceFlag{"a:1", "b:2"}
	if got := s.String(); got != "a:1,b:2" {
		t.Errorf("String() = %q, want a:1,b:2", got)
	}
}
