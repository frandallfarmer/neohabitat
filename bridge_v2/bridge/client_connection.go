package bridge

import (
	"github.com/juju/ratelimit"
	"github.com/rs/zerolog/log"
	"io"
	"net"
)

type ClientConnection struct {
	conn            net.Conn
	rateBucket      *ratelimit.Bucket
	rateLimitedConn io.Writer
}

func (c *ClientConnection) Read(p []byte) (n int, err error) {
	n, err = c.conn.Read(p)
	return n, err
}

func (c *ClientConnection) Write(p []byte) (n int, err error) {
	// If the last byte indicates an END_OF_MESSAGE, does not escape it.
	msg := p
	addEOM := false
	if p[len(p)-1] == END_OF_MESSAGE {
		msg = p[0 : len(p)-1]
		addEOM = true
	}
	escaped := Escape(msg)
	if addEOM {
		escaped = append(escaped, END_OF_MESSAGE)
	}
	if log.Trace().Enabled() {
		log.Trace().Str("ip", c.conn.RemoteAddr().String()).Hex("bytes", escaped).Msg("SEND")
	}
	return c.rateLimitedConn.Write(escaped)
}

// WriteRaw writes p to the rate-limited socket without applying the
// Habitat-level escape that Write performs. Used by the QLink/Habilink
// writer, where the QLink frame is its own escape envelope and we don't
// want to double-escape the bytes inside it.
func (c *ClientConnection) WriteRaw(p []byte) (n int, err error) {
	if log.Trace().Enabled() {
		log.Trace().Str("ip", c.conn.RemoteAddr().String()).Hex("bytes", p).Msg("SEND RAW")
	}
	return c.rateLimitedConn.Write(p)
}

func (c *ClientConnection) Close() error {
	return c.conn.Close()
}

func (c *ClientConnection) RemoteAddr() net.Addr {
	return c.conn.RemoteAddr()
}

func NewClientConnectionWithRate(conn net.Conn, dataRate int) *ClientConnection {
	byteRate := float64(dataRate) / 10.0
	rateBucket := ratelimit.NewBucketWithRate(byteRate, 1)
	return &ClientConnection{
		conn:            conn,
		rateBucket:      rateBucket,
		rateLimitedConn: ratelimit.Writer(conn, rateBucket),
	}
}

func NewClientConnection(b *Bridge, conn net.Conn) *ClientConnection {
	// Asynchronous 1200 baud serial uses 10 bits per byte (1 start, 8
	// data, 1 stop, no parity), so the real on-the-wire byte rate is
	// b.DataRate/10, NOT /8. With the 1200 baud setting that's 120
	// bytes/sec.
	//
	// Capacity is 1 — not DataRate/8 like the old code — so the bucket
	// can't pre-accumulate a whole reply's worth of tokens and burst
	// a packet out faster than the real modem would. A burstable
	// bucket let the VEND reply overtake the C64 client's own
	// COIN_DEPOSITED sound playback, which blew up the SID engine
	// (stack filled with $3D4B return addresses, hard lock). Holding
	// each byte to its 1/120s slot keeps the server-side timing
	// honest and matches what Habitat players actually experienced in
	// 1987.
	byteRate := float64(b.DataRate) / 10.0
	rateBucket := ratelimit.NewBucketWithRate(byteRate, 1)
	return &ClientConnection{
		conn:            conn,
		rateBucket:      rateBucket,
		rateLimitedConn: ratelimit.Writer(conn, rateBucket),
	}
}
