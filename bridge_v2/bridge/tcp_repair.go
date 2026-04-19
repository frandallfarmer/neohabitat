package bridge

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

// TCPState captures everything needed to reconstruct a TCP connection
// on a brand new socket via TCP_REPAIR. The new process creates a
// fresh socket, injects this state, and the remote peer never notices
// the switch — same sequence numbers, same window, same options.
type TCPState struct {
	LocalAddr  string `json:"local_addr"`
	LocalPort  int    `json:"local_port"`
	RemoteAddr string `json:"remote_addr"`
	RemotePort int    `json:"remote_port"`

	SndSeq uint32 `json:"snd_seq"`
	RcvSeq uint32 `json:"rcv_seq"`

	SndWl1    uint32 `json:"snd_wl1"`
	SndWnd    uint32 `json:"snd_wnd"`
	MaxWindow uint32 `json:"max_window"`
	RcvWnd    uint32 `json:"rcv_wnd"`
	RcvWup    uint32 `json:"rcv_wup"`

	MSSClamp uint32 `json:"mss_clamp"`
	SndBuf   int    `json:"snd_buf"`
	RcvBuf   int    `json:"rcv_buf"`

	SendQueue []byte `json:"send_queue,omitempty"`
	RecvQueue []byte `json:"recv_queue,omitempty"`
}

const (
	tcpRepair       = 19
	tcpRepairQueue  = 20
	tcpQueueSeq     = 21
	tcpRepairWindow = 29

	tcpRecvQueue = 1
	tcpSendQueue = 2
)

// tcpRepairWindowStruct matches struct tcp_repair_window from linux/tcp.h
type tcpRepairWindowStruct struct {
	SndWl1    uint32
	SndWnd    uint32
	MaxWindow uint32
	RcvWnd    uint32
	RcvWup    uint32
}

// SaveTCPState captures the full TCP connection state from a live
// socket and closes the socket while TCP_REPAIR is active (preventing
// FIN/RST). The net.Conn is unusable after this call. Requires
// CAP_NET_ADMIN.
func SaveTCPState(conn net.Conn) (*TCPState, error) {
	tc, ok := conn.(*net.TCPConn)
	if !ok {
		return nil, fmt.Errorf("not a *net.TCPConn: %T", conn)
	}

	localAddr := tc.LocalAddr().(*net.TCPAddr)
	remoteAddr := tc.RemoteAddr().(*net.TCPAddr)

	state := &TCPState{
		LocalAddr:  localAddr.IP.String(),
		LocalPort:  localAddr.Port,
		RemoteAddr: remoteAddr.IP.String(),
		RemotePort: remoteAddr.Port,
	}

	// Set TCP_REPAIR and save state on the ORIGINAL fd via Control.
	// TCP_REPAIR must be active on the original when tc.Close() runs
	// so the kernel closes silently (no FIN/RST, bind entry freed).
	// This matches the standalone test that works — the earlier
	// File()+dup approach set TCP_REPAIR on the dup but the original
	// got closed without it, causing normal close → TIME_WAIT.
	raw, err := tc.SyscallConn()
	if err != nil {
		return nil, fmt.Errorf("SyscallConn: %w", err)
	}
	var opErr error
	raw.Control(func(fd uintptr) {
		opErr = saveTCPStateFd(int(fd), state)
	})
	if err != nil {
		return nil, fmt.Errorf("Control: %w", err)
	}
	if opErr != nil {
		return nil, opErr
	}

	fmt.Fprintf(os.Stderr, "TCP_REPAIR SAVE: local=%s:%d remote=%s:%d snd=%d rcv=%d\n",
		state.LocalAddr, state.LocalPort, state.RemoteAddr, state.RemotePort,
		state.SndSeq, state.RcvSeq)

	// Get the fd number of the conn we're about to close. We need to
	// find and close any OTHER fds pointing to the same socket (from
	// tableflip's Fds.used dup) that would keep the socket alive.
	var ourFd uintptr
	raw.Control(func(fd uintptr) { ourFd = fd })

	// Find the socket inode
	ourLink, _ := os.Readlink(fmt.Sprintf("/proc/%d/fd/%d", os.Getpid(), ourFd))

	// Close with TCP_REPAIR active on the original fd.
	tc.Close()

	// Close any other fds pointing to the same socket inode.
	// tableflip's Fds.used may hold a dup that keeps the kernel
	// socket alive even after tc.Close().
	if ourLink != "" {
		fdDir := fmt.Sprintf("/proc/%d/fd", os.Getpid())
		entries, _ := os.ReadDir(fdDir)
		for _, e := range entries {
			var fdNum int
			fmt.Sscanf(e.Name(), "%d", &fdNum)
			if uintptr(fdNum) == ourFd {
				continue
			}
			link, _ := os.Readlink(fmt.Sprintf("%s/%s", fdDir, e.Name()))
			if link == ourLink {
				fmt.Fprintf(os.Stderr, "TCP_REPAIR: closing dup fd %d (same socket as %d)\n", fdNum, ourFd)
				unix.Close(fdNum)
			}
		}
	}

	return state, nil
}

func saveTCPStateFd(fd int, state *TCPState) error {
	// Enable TCP_REPAIR mode. We intentionally do NOT disable it on
	// return — the caller must close the socket while repair mode is
	// still active. Closing a socket in repair mode does NOT send
	// FIN/RST to the peer, which is essential: the peer must not know
	// the connection was torn down, because the child process is about
	// to recreate it with the saved state.
	if err := syscall.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepair, 1); err != nil {
		return fmt.Errorf("enable TCP_REPAIR: %w", err)
	}

	// Get TCP_INFO for sequence numbers
	info, err := unix.GetsockoptTCPInfo(fd, unix.IPPROTO_TCP, unix.TCP_INFO)
	if err != nil {
		return fmt.Errorf("TCP_INFO: %w", err)
	}

	// In repair mode, TCP_QUEUE_SEQ returns the actual sequence number
	// for each queue direction.
	if err := syscall.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepairQueue, tcpSendQueue); err != nil {
		return fmt.Errorf("set send queue: %w", err)
	}
	sndSeq, err := unix.GetsockoptInt(fd, unix.IPPROTO_TCP, tcpQueueSeq)
	if err != nil {
		return fmt.Errorf("get send seq: %w", err)
	}
	state.SndSeq = uint32(sndSeq)

	if err := syscall.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepairQueue, tcpRecvQueue); err != nil {
		return fmt.Errorf("set recv queue: %w", err)
	}
	rcvSeq, err := unix.GetsockoptInt(fd, unix.IPPROTO_TCP, tcpQueueSeq)
	if err != nil {
		return fmt.Errorf("get recv seq: %w", err)
	}
	state.RcvSeq = uint32(rcvSeq)

	// Get MSS clamp (repair mode returns the negotiated clamp value)
	mss, err := unix.GetsockoptInt(fd, unix.IPPROTO_TCP, unix.TCP_MAXSEG)
	if err != nil {
		return fmt.Errorf("TCP_MAXSEG: %w", err)
	}
	state.MSSClamp = uint32(mss)

	// Get window parameters
	var win tcpRepairWindowStruct
	winLen := uint32(unsafe.Sizeof(win))
	_, _, errno := syscall.Syscall6(
		syscall.SYS_GETSOCKOPT,
		uintptr(fd),
		unix.IPPROTO_TCP,
		tcpRepairWindow,
		uintptr(unsafe.Pointer(&win)),
		uintptr(unsafe.Pointer(&winLen)),
		0,
	)
	if errno != 0 {
		return fmt.Errorf("TCP_REPAIR_WINDOW: %w", errno)
	}
	state.SndWl1 = win.SndWl1
	state.SndWnd = win.SndWnd
	state.MaxWindow = win.MaxWindow
	state.RcvWnd = win.RcvWnd
	state.RcvWup = win.RcvWup

	// Get buffer sizes
	state.SndBuf, _ = unix.GetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_SNDBUF)
	state.RcvBuf, _ = unix.GetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_RCVBUF)

	// Log sequence info for debugging (uses the tcp_info we already got)
	_ = info // used above for reference; seq comes from TCP_QUEUE_SEQ in repair mode

	return nil
}

// RestoreTCPConn creates a brand new TCP socket and injects saved state
// via TCP_REPAIR, bringing it directly to ESTABLISHED without a
// handshake. The remote peer sees continuous sequence numbers. Requires
// CAP_NET_ADMIN.
func RestoreTCPConn(state *TCPState) (net.Conn, error) {
	// Determine address family
	localIP := net.ParseIP(state.LocalAddr)
	remoteIP := net.ParseIP(state.RemoteAddr)
	family := unix.AF_INET
	if localIP.To4() == nil {
		family = unix.AF_INET6
	}

	fd, err := unix.Socket(family, unix.SOCK_STREAM, unix.IPPROTO_TCP)
	if err != nil {
		return nil, fmt.Errorf("socket: %w", err)
	}

	// Enable TCP_REPAIR immediately before any bind/connect
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepair, 1); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("enable TCP_REPAIR: %w", err)
	}

	// Allow address reuse (the old socket may linger briefly)
	unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)

	// Restore buffer sizes (set before bind, kernel doubles internally)
	if state.SndBuf > 0 {
		unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_SNDBUF, state.SndBuf/2)
	}
	if state.RcvBuf > 0 {
		unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_RCVBUF, state.RcvBuf/2)
	}

	// Bind to the local address
	if family == unix.AF_INET {
		sa := &unix.SockaddrInet4{Port: state.LocalPort}
		copy(sa.Addr[:], localIP.To4())
		if err := unix.Bind(fd, sa); err != nil {
			unix.Close(fd)
			return nil, fmt.Errorf("bind: %w", err)
		}
	} else {
		sa := &unix.SockaddrInet6{Port: state.LocalPort}
		copy(sa.Addr[:], remoteIP.To16())
		if err := unix.Bind(fd, sa); err != nil {
			unix.Close(fd)
			return nil, fmt.Errorf("bind6: %w", err)
		}
	}

	// Restore send queue sequence
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepairQueue, tcpSendQueue); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("set send queue: %w", err)
	}
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpQueueSeq, int(state.SndSeq)); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("set send seq: %w", err)
	}

	// Restore receive queue sequence
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepairQueue, tcpRecvQueue); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("set recv queue: %w", err)
	}
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpQueueSeq, int(state.RcvSeq)); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("set recv seq: %w", err)
	}

	// Restore window parameters
	win := tcpRepairWindowStruct{
		SndWl1:    state.SndWl1,
		SndWnd:    state.SndWnd,
		MaxWindow: state.MaxWindow,
		RcvWnd:    state.RcvWnd,
		RcvWup:    state.RcvWup,
	}
	_, _, errno := syscall.Syscall6(
		syscall.SYS_SETSOCKOPT,
		uintptr(fd),
		unix.IPPROTO_TCP,
		tcpRepairWindow,
		uintptr(unsafe.Pointer(&win)),
		unsafe.Sizeof(win),
		0,
	)
	if errno != 0 {
		unix.Close(fd)
		return nil, fmt.Errorf("TCP_REPAIR_WINDOW: %w", errno)
	}

	// Restore MSS clamp
	opt := unix.TCPRepairOpt{
		Code: unix.TCPOPT_MAXSEG,
		Val:  state.MSSClamp,
	}
	if err := unix.SetsockoptTCPRepairOpt(fd, unix.IPPROTO_TCP, unix.TCP_REPAIR_OPTIONS, []unix.TCPRepairOpt{opt}); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("TCP_REPAIR_OPTIONS MSS: %w", err)
	}

	// Connect to remote — in repair mode this goes directly to
	// ESTABLISHED without a SYN handshake
	if family == unix.AF_INET {
		sa := &unix.SockaddrInet4{Port: state.RemotePort}
		copy(sa.Addr[:], remoteIP.To4())
		if err := unix.Connect(fd, sa); err != nil {
			unix.Close(fd)
			return nil, fmt.Errorf("connect: %w", err)
		}
	} else {
		sa := &unix.SockaddrInet6{Port: state.RemotePort}
		copy(sa.Addr[:], remoteIP.To16())
		if err := unix.Connect(fd, sa); err != nil {
			unix.Close(fd)
			return nil, fmt.Errorf("connect6: %w", err)
		}
	}

	// Disable repair mode — kernel sends a window probe to restart
	// traffic, connection is now fully live
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepair, 0); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("disable TCP_REPAIR: %w", err)
	}

	// Return the raw fd. The caller decides how to wrap it —
	// the parent keeps it blocking for fd passing, the child
	// sets non-blocking for net.FileConn.
	return fdToConn(fd, state)
}

// fdToConn wraps a raw TCP fd in a net.Conn. Sets non-blocking and
// uses net.FileConn which registers with Go's poller.
func fdToConn(fd int, state *TCPState) (net.Conn, error) {
	unix.SetNonblock(fd, true)
	f := os.NewFile(uintptr(fd), fmt.Sprintf("tcp-repair-%s:%d", state.RemoteAddr, state.RemotePort))
	conn, err := net.FileConn(f)
	f.Close()
	if err != nil {
		return nil, fmt.Errorf("FileConn: %w", err)
	}
	return conn, nil
}

// SaveAndRestoreTCPConn performs the full CRIU-style TCP takeover in a
// single process: saves state, closes the old socket (in repair mode,
// no FIN/RST), then immediately creates a new socket with the saved
// state. Returns a raw fd in BLOCKING mode suitable for passing to a
// child process. The caller must NOT wrap it in net.FileConn in the
// parent — that would register it with Go's poller.
func SaveAndRestoreTCPConn(conn net.Conn) (*TCPState, int, error) {
	state, err := SaveTCPState(conn)
	if err != nil {
		return nil, -1, err
	}

	// Retry the restore with increasing delays. A socket that was
	// itself established via TCP_REPAIR may take longer for the
	// kernel to fully remove from the ehash after close.
	var fd int
	for attempt := 0; attempt < 5; attempt++ {
		time.Sleep(time.Duration(50*(1+attempt)) * time.Millisecond)
		fd, err = restoreTCPFd(state)
		if err == nil {
			break
		}
		fmt.Fprintf(os.Stderr, "TCP_REPAIR restore attempt %d: %v\n", attempt+1, err)
	}
	if err != nil {
		return state, -1, fmt.Errorf("restore after save: %w", err)
	}

	// Leave the fd in BLOCKING mode so it doesn't get registered
	// with the parent's epoll when wrapped in os.NewFile for passing.
	return state, fd, nil
}

// restoreTCPFd is the inner restore that returns a raw fd instead of
// a net.Conn. Used by SaveAndRestoreTCPConn.
func restoreTCPFd(state *TCPState) (int, error) {
	localIP := net.ParseIP(state.LocalAddr)
	remoteIP := net.ParseIP(state.RemoteAddr)
	family := unix.AF_INET
	if localIP.To4() == nil {
		family = unix.AF_INET6
	}

	fd, err := unix.Socket(family, unix.SOCK_STREAM, unix.IPPROTO_TCP)
	if err != nil {
		return -1, fmt.Errorf("socket: %w", err)
	}

	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepair, 1); err != nil {
		unix.Close(fd)
		return -1, fmt.Errorf("enable TCP_REPAIR: %w", err)
	}

	unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_REUSEADDR, 1)
	unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)

	if state.SndBuf > 0 {
		unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_SNDBUF, state.SndBuf/2)
	}
	if state.RcvBuf > 0 {
		unix.SetsockoptInt(fd, unix.SOL_SOCKET, unix.SO_RCVBUF, state.RcvBuf/2)
	}

	if family == unix.AF_INET {
		sa := &unix.SockaddrInet4{Port: state.LocalPort}
		copy(sa.Addr[:], localIP.To4())
		if err := unix.Bind(fd, sa); err != nil {
			unix.Close(fd)
			return -1, fmt.Errorf("bind %s:%d: %w", state.LocalAddr, state.LocalPort, err)
		}
	} else {
		sa := &unix.SockaddrInet6{Port: state.LocalPort}
		copy(sa.Addr[:], localIP.To16())
		if err := unix.Bind(fd, sa); err != nil {
			unix.Close(fd)
			return -1, fmt.Errorf("bind6: %w", err)
		}
	}

	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepairQueue, tcpSendQueue); err != nil {
		unix.Close(fd)
		return -1, fmt.Errorf("set send queue: %w", err)
	}
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpQueueSeq, int(state.SndSeq)); err != nil {
		unix.Close(fd)
		return -1, fmt.Errorf("set send seq: %w", err)
	}

	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepairQueue, tcpRecvQueue); err != nil {
		unix.Close(fd)
		return -1, fmt.Errorf("set recv queue: %w", err)
	}
	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpQueueSeq, int(state.RcvSeq)); err != nil {
		unix.Close(fd)
		return -1, fmt.Errorf("set recv seq: %w", err)
	}

	win := tcpRepairWindowStruct{
		SndWl1: state.SndWl1, SndWnd: state.SndWnd,
		MaxWindow: state.MaxWindow, RcvWnd: state.RcvWnd, RcvWup: state.RcvWup,
	}
	_, _, errno := syscall.Syscall6(syscall.SYS_SETSOCKOPT,
		uintptr(fd), unix.IPPROTO_TCP, tcpRepairWindow,
		uintptr(unsafe.Pointer(&win)), unsafe.Sizeof(win), 0)
	if errno != 0 {
		unix.Close(fd)
		return -1, fmt.Errorf("TCP_REPAIR_WINDOW: %w", errno)
	}

	// MSS clamp restore is best-effort — the kernel will negotiate
	// a working MSS on the first data exchange if this fails.
	if state.MSSClamp > 0 {
		opt := unix.TCPRepairOpt{Code: unix.TCPOPT_MAXSEG, Val: state.MSSClamp}
		unix.SetsockoptTCPRepairOpt(fd, unix.IPPROTO_TCP, unix.TCP_REPAIR_OPTIONS, []unix.TCPRepairOpt{opt})
	}

	fmt.Fprintf(os.Stderr, "TCP_REPAIR RESTORE: bind=%s:%d connect=%s:%d\n",
		state.LocalAddr, state.LocalPort, state.RemoteAddr, state.RemotePort)

	if family == unix.AF_INET {
		sa := &unix.SockaddrInet4{Port: state.RemotePort}
		copy(sa.Addr[:], remoteIP.To4())
		if err := unix.Connect(fd, sa); err != nil {
			unix.Close(fd)
			return -1, fmt.Errorf("connect: %w", err)
		}
	} else {
		sa := &unix.SockaddrInet6{Port: state.RemotePort}
		copy(sa.Addr[:], remoteIP.To16())
		if err := unix.Connect(fd, sa); err != nil {
			unix.Close(fd)
			return -1, fmt.Errorf("connect6: %w", err)
		}
	}

	if err := unix.SetsockoptInt(fd, unix.IPPROTO_TCP, tcpRepair, 0); err != nil {
		unix.Close(fd)
		return -1, fmt.Errorf("disable TCP_REPAIR: %w", err)
	}

	return fd, nil
}

// MarshalTCPState serializes TCP state to JSON for the handoff manifest.
func MarshalTCPState(state *TCPState) ([]byte, error) {
	return json.Marshal(state)
}

// UnmarshalTCPState deserializes TCP state from JSON.
func UnmarshalTCPState(data []byte) (*TCPState, error) {
	var state TCPState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}
