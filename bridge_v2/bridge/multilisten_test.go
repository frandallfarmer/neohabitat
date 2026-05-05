package bridge

import (
	"net"
	"sort"
	"testing"
)

// listenPorts is the set the SnapshotAllWithTCP /proc walk uses to
// decide whether a listening fd belongs to this bridge. If any port
// goes missing here, that fd survives the snapshot and the new bridge
// can't TCP_REPAIR-bind on it. Cover the parsing for IPv4, IPv6, and
// junk inputs.
func TestListenPorts(t *testing.T) {
	cases := []struct {
		name  string
		addrs []string
		want  []int
	}{
		{
			name:  "single ipv4",
			addrs: []string{"0.0.0.0:1337"},
			want:  []int{1337},
		},
		{
			name:  "three distinct ipv4",
			addrs: []string{"0.0.0.0:1337", "0.0.0.0:1986", "0.0.0.0:2026"},
			want:  []int{1337, 1986, 2026},
		},
		{
			name:  "ipv6 bracketed",
			addrs: []string{"[::]:2026"},
			want:  []int{2026},
		},
		{
			name:  "duplicates collapse",
			addrs: []string{"0.0.0.0:1337", "127.0.0.1:1337"},
			want:  []int{1337},
		},
		{
			name:  "garbage entry skipped",
			addrs: []string{"not-a-host-port", "0.0.0.0:2026"},
			want:  []int{2026},
		},
		{
			name:  "non-numeric port skipped",
			addrs: []string{"0.0.0.0:abc", "0.0.0.0:2026"},
			want:  []int{2026},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b := NewBridge("ctx", c.addrs, "elko:9000",
				"mongodb://localhost:27017", "elko", "odb", 1200, false)
			got := b.listenPorts()
			gotSlice := make([]int, 0, len(got))
			for p := range got {
				gotSlice = append(gotSlice, p)
			}
			sort.Ints(gotSlice)
			sort.Ints(c.want)
			if !equalIntSlice(gotSlice, c.want) {
				t.Errorf("listenPorts() = %v, want %v", gotSlice, c.want)
			}
		})
	}
}

// NewBridge takes a slice of listen addresses; verify the constructor
// stores them defensively (caller mutating the slice afterward must
// not affect the bridge).
func TestNewBridge_DefensiveCopyOfListenAddrs(t *testing.T) {
	addrs := []string{"0.0.0.0:1337", "0.0.0.0:1986"}
	b := NewBridge("ctx", addrs, "elko:9000",
		"mongodb://localhost:27017", "elko", "odb", 1200, false)
	addrs[0] = "0.0.0.0:9999"
	ports := b.listenPorts()
	if _, ok := ports[1337]; !ok {
		t.Errorf("bridge lost port 1337 when caller mutated input slice; got %v", ports)
	}
	if _, ok := ports[9999]; ok {
		t.Error("bridge picked up caller's post-construction mutation; want defensive copy")
	}
}

// SetListeners must accept the same number of listeners as configured
// addresses so Run()'s lazy-fill can find them by index. Verify the
// happy path round-trips.
func TestSetListeners_RoundTrip(t *testing.T) {
	b := NewBridge("ctx",
		[]string{"127.0.0.1:0", "127.0.0.1:0"},
		"elko:9000", "mongodb://localhost:27017", "elko", "odb", 1200, false)

	a, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen a: %v", err)
	}
	defer a.Close()
	c, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen b: %v", err)
	}
	defer c.Close()

	b.SetListeners([]net.Listener{a, c})
	if len(b.listeners) != 2 {
		t.Fatalf("listeners len = %d, want 2", len(b.listeners))
	}
	if b.listeners[0].Addr().String() != a.Addr().String() {
		t.Errorf("listeners[0] = %v, want %v", b.listeners[0].Addr(), a.Addr())
	}
}

// noidU8 is the narrowing helper for *uint16 noid fields (Speaker,
// Appearing). Verify the three branches: nil, sentinel, in-range.
func TestNoidU8(t *testing.T) {
	if got := noidU8(nil); got != 0 {
		t.Errorf("noidU8(nil) = %d, want 0", got)
	}
	sentinel := UNASSIGNED_NOID
	if got := noidU8(&sentinel); got != GHOST_NOID {
		t.Errorf("noidU8(UNASSIGNED_NOID=%d) = %d, want GHOST_NOID=%d", sentinel, got, GHOST_NOID)
	}
	in := uint16(42)
	if got := noidU8(&in); got != 42 {
		t.Errorf("noidU8(42) = %d, want 42", got)
	}
	// 255 is GHOST_NOID itself; should pass through unchanged.
	g := uint16(255)
	if got := noidU8(&g); got != 255 {
		t.Errorf("noidU8(255) = %d, want 255", got)
	}
}

func equalIntSlice(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
