package bridge

import (
	"bufio"
	"io"
	"net"
	"strings"
	"testing"
)

// addrConn is a fake net.Conn with a configurable peer address, for
// exercising the PROXY-header trust check without real sockets.
type addrConn struct {
	discardConn
	remote net.Addr
}

func (a *addrConn) RemoteAddr() net.Addr { return a.remote }

func newProxyTestSession(peerIP string, stream string) *ClientSession {
	bridge := &Bridge{DataRate: 1 << 20}
	conn := &addrConn{remote: &net.TCPAddr{IP: net.ParseIP(peerIP), Port: 55555}}
	cc := NewClientConnection(bridge, conn)
	return &ClientSession{
		bridge:       bridge,
		clientConn:   cc,
		clientReader: bufio.NewReader(strings.NewReader(stream)),
		done:         make(chan struct{}),
	}
}

func TestParseProxyV1Line(t *testing.T) {
	cases := []struct {
		line string
		want string
		ok   bool
	}{
		{"PROXY TCP4 60.234.208.18 127.0.0.1 51234 2026\r\n", "60.234.208.18:51234", true},
		{"PROXY TCP6 2001:db8::7 ::1 51234 2026\r\n", "[2001:db8::7]:51234", true},
		{"PROXY UNKNOWN\r\n", "", false},
		{"PROXY TCP4 not-an-ip 127.0.0.1 1 2\r\n", "", false},
		{"PROXY TCP4 1.2.3.4 127.0.0.1 nope 2\r\n", "", false},
		{"PROXY TCP4 1.2.3.4 127.0.0.1 1\r\n", "", false},
		{"GARBAGE LINE\r\n", "", false},
	}
	for _, c := range cases {
		got, ok := parseProxyV1Line([]byte(c.line))
		if ok != c.ok || got != c.want {
			t.Errorf("parseProxyV1Line(%q) = (%q, %v), want (%q, %v)",
				c.line, got, ok, c.want, c.ok)
		}
	}
}

func TestProxyHeaderConsumedFromPrivatePeer(t *testing.T) {
	s := newProxyTestSession("172.18.0.3",
		"PROXY TCP4 60.234.208.18 127.0.0.1 51234 2026\r\n{\"op\":\"x\"}\n")
	s.maybeConsumeProxyHeader()
	if s.realClientAddr != "60.234.208.18:51234" {
		t.Fatalf("realClientAddr = %q, want 60.234.208.18:51234", s.realClientAddr)
	}
	if got := s.RealClientAddr(); got != "60.234.208.18:51234" {
		t.Fatalf("RealClientAddr() = %q", got)
	}
	// The full header including the trailing \n must be consumed so
	// protocol sniffing sees the JSON open-brace next.
	b, err := s.clientReader.Peek(1)
	if err != nil || b[0] != '{' {
		t.Fatalf("next byte after header = %q, %v; want '{'", b, err)
	}
}

func TestProxyHeaderIgnoredFromPublicPeer(t *testing.T) {
	stream := "PROXY TCP4 1.2.3.4 127.0.0.1 1 2\r\n"
	s := newProxyTestSession("8.8.8.8", stream)
	s.maybeConsumeProxyHeader()
	if s.realClientAddr != "" {
		t.Fatalf("realClientAddr = %q, want empty (public peer must not spoof)", s.realClientAddr)
	}
	// Stream must be untouched for normal protocol handling.
	got := make([]byte, len(stream))
	if _, err := io.ReadFull(s.clientReader, got); err != nil || string(got) != stream {
		t.Fatalf("stream after ignored header = %q, %v", got, err)
	}
}

func TestProxyHeaderLeavesNonProxyDataAlone(t *testing.T) {
	stream := "Phil:1234\n"
	s := newProxyTestSession("127.0.0.1", stream)
	s.maybeConsumeProxyHeader()
	if s.realClientAddr != "" {
		t.Fatalf("realClientAddr = %q, want empty", s.realClientAddr)
	}
	got := make([]byte, len(stream))
	if _, err := io.ReadFull(s.clientReader, got); err != nil || string(got) != stream {
		t.Fatalf("stream after check = %q, %v", got, err)
	}
}

func TestProxyHeaderMalformedLineConsumedButNoOverride(t *testing.T) {
	// A malformed PROXY line from a trusted peer is consumed (it can't be
	// valid protocol data) but must not set an origin override.
	s := newProxyTestSession("10.0.0.5", "PROXY TCP4 broken\r\n{\"op\":\"x\"}\n")
	s.maybeConsumeProxyHeader()
	if s.realClientAddr != "" {
		t.Fatalf("realClientAddr = %q, want empty", s.realClientAddr)
	}
	b, err := s.clientReader.Peek(1)
	if err != nil || b[0] != '{' {
		t.Fatalf("next byte after malformed header = %q, %v; want '{'", b, err)
	}
}
