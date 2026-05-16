package bridge

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/rs/zerolog"
)

const ringlogCap = 20

// LogEntry is one captured log line exposed by the admin /logs endpoint.
type LogEntry struct {
	Level   string          `json:"level"`
	Time    string          `json:"time,omitempty"`
	Message string          `json:"message"`
	Fields  json.RawMessage `json:"fields,omitempty"`
}

// RingLog is a zerolog LevelWriter that retains the last ringlogCap
// error- and warn-level entries in memory. Thread-safe.
type RingLog struct {
	mu      sync.Mutex
	entries []LogEntry
}

// NewRingLog returns an initialised RingLog.
func NewRingLog() *RingLog { return &RingLog{} }

// WriteLevel satisfies zerolog.LevelWriter. Only error and warn entries
// are retained; all other levels are silently discarded.
func (r *RingLog) WriteLevel(level zerolog.Level, p []byte) (int, error) {
	if level != zerolog.ErrorLevel && level != zerolog.WarnLevel {
		return len(p), nil
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(p, &raw); err != nil {
		return len(p), nil
	}

	entry := LogEntry{Level: level.String()}
	if m, ok := raw["message"]; ok {
		_ = json.Unmarshal(m, &entry.Message)
	}
	if t, ok := raw["time"]; ok {
		_ = json.Unmarshal(t, &entry.Time)
	}

	// Collect all fields that are not the standard zerolog envelope keys.
	fields := make(map[string]json.RawMessage)
	for k, v := range raw {
		switch k {
		case "level", "message", "time":
			// skip
		default:
			fields[k] = v
		}
	}
	if len(fields) > 0 {
		entry.Fields, _ = json.Marshal(fields)
	}

	r.mu.Lock()
	r.entries = append(r.entries, entry)
	if len(r.entries) > ringlogCap {
		r.entries = r.entries[len(r.entries)-ringlogCap:]
	}
	r.mu.Unlock()
	return len(p), nil
}

// Write satisfies io.Writer (required by zerolog.MultiLevelWriter). Since
// we only care about levelled writes, this is a no-op.
func (r *RingLog) Write(p []byte) (int, error) { return len(p), nil }

// Entries returns a copy of the retained entries, newest last.
func (r *RingLog) Entries() []LogEntry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]LogEntry, len(r.entries))
	copy(out, r.entries)
	return out
}

// ServeHTTP handles GET /logs — returns JSON array of retained entries.
// Supports ?level=error or ?level=warn to filter.
func (r *RingLog) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	levelFilter := req.URL.Query().Get("level")

	entries := r.Entries()
	out := entries[:0:0]
	for _, e := range entries {
		if levelFilter == "" || e.Level == levelFilter {
			out = append(out, e)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
