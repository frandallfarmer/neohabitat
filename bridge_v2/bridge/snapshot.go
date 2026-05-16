package bridge

import (
	"encoding/json"
	"fmt"
	"os"
)

// SessionSnapshot captures all per-session state needed to reconstruct a
// live ClientSession from a serialized JSON blob plus inherited file
// descriptors. Every field here is JSON-serializable; channels, mutexes,
// goroutine state, and derived caches are omitted and rebuilt on restore.
type SessionSnapshot struct {
	SessionID    string `json:"session_id"`
	UserName     string `json:"user_name"`
	UserRef      string `json:"user_ref"`
	RegionRef    string `json:"region_ref"`
	Ref          string `json:"ref"`
	Who          string `json:"who"`
	PacketPrefix string `json:"packet_prefix,omitempty"`

	Connected         bool `json:"connected"`
	FirstConnection   bool `json:"first_connection"`
	HatcheryPending   bool `json:"hatchery_pending"`
	HatcheryCompleted bool `json:"hatchery_completed"`
	JsonPassthrough   bool `json:"json_passthrough"`
	QLinkMode         bool `json:"qlink_mode"`
	Online            bool `json:"online"`

	QLinkInSeq  byte  `json:"qlink_in_seq"`
	QLinkOutSeq byte  `json:"qlink_out_seq"`
	ReplySeq    uint8 `json:"reply_seq"`

	Avatar     *HabitatMod `json:"avatar,omitempty"`
	AvatarNoid *uint8      `json:"avatar_noid,omitempty"`

	// Objects is a flat list of the per-noid ElkoMessage plus the
	// derived container field (unexported on ElkoMessage, so we
	// extract it explicitly).
	Objects         []ObjectSnapshot `json:"objects"`
	ObjectNoidOrder []uint8          `json:"object_noid_order"`
	RefToNoid       map[string]uint8 `json:"ref_to_noid"`
	NoidClassList   []uint8          `json:"noid_class_list"`
	// JSON map keys must be strings; we encode uint8 keys as decimal.
	NoidContents map[string][]uint8 `json:"noid_contents"`

	NextRegion    string `json:"next_region"`
	NextRegionSet bool   `json:"next_region_set"`

	WaitingForAvatar         bool `json:"waiting_for_avatar"`
	WaitingForAvatarContents bool `json:"waiting_for_avatar_contents"`

	User *HabitatObject `json:"user,omitempty"`

	LargeRequestCache []byte `json:"large_request_cache,omitempty"`

	// BufferedClientData holds bytes that were in the bufio.Reader's
	// buffer at snapshot time — already read from the kernel socket but
	// not yet consumed by the protocol handler. Without this the child
	// would silently lose mid-frame data.
	BufferedClientData []byte `json:"buffered_client_data,omitempty"`
	BufferedElkoData   []byte `json:"buffered_elko_data,omitempty"`

	// TCP connection state for TCP_REPAIR restore. When present, the
	// child creates brand new sockets and injects this state instead
	// of inheriting fds. No epoll conflicts, no blocking-mode issues.
	ClientTCP *TCPState `json:"client_tcp,omitempty"`
	ElkoTCP   *TCPState `json:"elko_tcp,omitempty"`

	DataRate int `json:"data_rate"`

	// restoredClientFd holds the raw fd of a TCP_REPAIR'd client socket
	// created by the parent. Not serialized — only used in-memory
	// between SnapshotAllWithTCP and the fd passing in main.go.
	restoredClientFd int `json:"-"`
}

// RestoredClientFd returns the raw fd for the restored client socket.
func (s *SessionSnapshot) RestoredClientFd() int {
	return s.restoredClientFd
}

// ObjectSnapshot captures one entry from the objects map. The unexported
// fields on ElkoMessage (className, classNumber, clientMessages, etc.)
// are derived by unpackHabitatObject and don't need serialization.
type ObjectSnapshot struct {
	Noid      uint8        `json:"noid"`
	Message   *ElkoMessage `json:"message"`
	Container uint8        `json:"container"`
}

// HandoffManifest is the top-level document written to the snapshot file
// and consumed by the child process on startup.
type HandoffManifest struct {
	Sessions  []SessionSnapshot `json:"sessions"`
	QLinkMode bool              `json:"qlink_mode"`
	ElkoHost  string            `json:"elko_host"`
	Context   string            `json:"context"`
}

func WriteManifest(path string, m *HandoffManifest) error {
	data, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	return os.WriteFile(path, data, 0600)
}

func ReadManifest(path string) (*HandoffManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	var m HandoffManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("unmarshal manifest: %w", err)
	}
	return &m, nil
}

func noidContentsToStringKeys(m map[uint8][]uint8) map[string][]uint8 {
	out := make(map[string][]uint8, len(m))
	for k, v := range m {
		out[fmt.Sprintf("%d", k)] = v
	}
	return out
}

func stringKeysToNoidContents(m map[string][]uint8) map[uint8][]uint8 {
	out := make(map[uint8][]uint8, len(m))
	for k, v := range m {
		var n uint8
		fmt.Sscanf(k, "%d", &n)
		out[n] = v
	}
	return out
}
