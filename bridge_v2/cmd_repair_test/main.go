package main

import (
	"fmt"
	"net"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func main() {
	ln, _ := net.Listen("tcp", "0.0.0.0:0")
	addr := ln.Addr().String()
	_, port, _ := net.SplitHostPort(addr)
	fmt.Println("listening on", addr)

	go func() { net.Dial("tcp", "127.0.0.1:"+port) }()
	conn, _ := ln.Accept()

	tc := conn.(*net.TCPConn)
	local := tc.LocalAddr().(*net.TCPAddr)
	remote := tc.RemoteAddr().(*net.TCPAddr)
	fmt.Printf("local=%s remote=%s\n", local, remote)

	raw, _ := tc.SyscallConn()
	raw.Control(func(fd uintptr) {
		syscall.SetsockoptInt(int(fd), unix.IPPROTO_TCP, 19, 1)
	})
	tc.Close()
	time.Sleep(50 * time.Millisecond)

	fmt.Println("--- listener still alive on", addr, "---")

	// Try 1: bind specific IP
	fd, _ := unix.Socket(unix.AF_INET, unix.SOCK_STREAM, 0)
	unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)
	unix.SetsockoptInt(fd, unix.IPPROTO_TCP, 19, 1)
	sa := &unix.SockaddrInet4{Port: local.Port}
	copy(sa.Addr[:], local.IP.To4())
	err := unix.Bind(fd, sa)
	fmt.Println("bind specific IP:", err)
	unix.Close(fd)

	// Try 2: bind 0.0.0.0
	fd2, _ := unix.Socket(unix.AF_INET, unix.SOCK_STREAM, 0)
	unix.SetsockoptInt(fd2, unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)
	unix.SetsockoptInt(fd2, unix.IPPROTO_TCP, 19, 1)
	sa2 := &unix.SockaddrInet4{Port: local.Port}
	err = unix.Bind(fd2, sa2)
	fmt.Println("bind 0.0.0.0:", err)
	if err == nil {
		rsa := &unix.SockaddrInet4{Port: remote.Port}
		copy(rsa.Addr[:], remote.IP.To4())
		err = unix.Connect(fd2, rsa)
		fmt.Println("connect:", err)
	}
	unix.Close(fd2)

	// Try 3: skip bind, just connect (let kernel auto-bind)
	fd3, _ := unix.Socket(unix.AF_INET, unix.SOCK_STREAM, 0)
	unix.SetsockoptInt(fd3, unix.IPPROTO_TCP, 19, 1)
	rsa3 := &unix.SockaddrInet4{Port: remote.Port}
	copy(rsa3.Addr[:], remote.IP.To4())
	err = unix.Connect(fd3, rsa3)
	fmt.Println("connect without bind:", err)
	unix.Close(fd3)

	ln.Close()
}
