// wireproxy — a tiny transparent TCP proxy that logs every byte in both
// directions to separate hex dump files, so you can diff the wire between
// two different backends for the same client scenario.
//
// Usage:
//   go run ./tools/wireproxy -listen 127.0.0.1:9900 -upstream 127.0.0.1:2026 \
//           -tag bridge_v2
//   # point VICE at 127.0.0.1:9900, run the scenario, Ctrl-C.
//   # Writes bridge_v2.downstream.hex (bytes from upstream to VICE)
//   # and    bridge_v2.upstream.hex   (bytes from VICE to upstream).
//
// Each line of output is a timestamped, newline-separated chunk of bytes as
// received from the socket, so packet boundaries are preserved. Hex+ASCII
// rendering on each line for easy diffing.
package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"time"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:9900", "address to listen on")
	upstream := flag.String("upstream", "127.0.0.1:2026", "upstream address to forward to")
	tag := flag.String("tag", "proxy", "filename prefix for capture files")
	outdir := flag.String("outdir", ".", "directory to write capture files into")
	flag.Parse()

	l, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatalf("listen %s: %v", *listen, err)
	}
	log.Printf("wireproxy listening on %s, forwarding to %s, tag=%s",
		*listen, *upstream, *tag)

	for {
		conn, err := l.Accept()
		if err != nil {
			log.Printf("accept: %v", err)
			continue
		}
		go handle(conn, *upstream, *tag, *outdir)
	}
}

func handle(client net.Conn, upstream, tag, outdir string) {
	defer client.Close()

	server, err := net.Dial("tcp", upstream)
	if err != nil {
		log.Printf("dial %s: %v", upstream, err)
		return
	}
	defer server.Close()

	upPath := filepath.Join(outdir, tag+".upstream.hex")
	downPath := filepath.Join(outdir, tag+".downstream.hex")

	upFile, err := os.Create(upPath)
	if err != nil {
		log.Fatalf("create %s: %v", upPath, err)
	}
	defer upFile.Close()

	downFile, err := os.Create(downPath)
	if err != nil {
		log.Fatalf("create %s: %v", downPath, err)
	}
	defer downFile.Close()

	log.Printf("capture -> %s (client→upstream), %s (upstream→client)",
		upPath, downPath)

	done := make(chan struct{}, 2)

	// client → upstream (what the C64 sends)
	go copyAndLog(client, server, upFile, "C→S", done)
	// upstream → client (what the bridge sends to the C64)
	go copyAndLog(server, client, downFile, "S→C", done)

	<-done
	<-done
	log.Printf("connection closed, captures in %s / %s", upPath, downPath)
}

func copyAndLog(src, dst net.Conn, w io.Writer, label string, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()

	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			// Dump timestamped hex+ascii
			ts := time.Now().Format("15:04:05.000000")
			fmt.Fprintf(w, "%s %s %3d |", ts, label, n)
			for _, b := range chunk {
				fmt.Fprintf(w, " %02X", b)
			}
			fmt.Fprintf(w, " | ")
			for _, b := range chunk {
				if b >= 0x20 && b < 0x7f {
					fmt.Fprintf(w, "%c", b)
				} else {
					fmt.Fprintf(w, ".")
				}
			}
			fmt.Fprintf(w, "\n")
			// Forward as-is
			if _, werr := dst.Write(chunk); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}
