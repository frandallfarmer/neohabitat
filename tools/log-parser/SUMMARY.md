# Habitat Log Analysis Tools - Summary

This document summarizes the debugging tools created for analyzing NeoHabitat server logs.

## What Was Built

### Complete Toolkit (6 Tools)

1. **session-analyzer.js** ⭐ NEW
   - Multi-log correlator for complete session analysis
   - Combines Q-Link + Bridge logs chronologically
   - Filters by username and datetime
   - Shows all three protocol layers in one view

2. **qlink-decoder.js** ⭐ NEW
   - Q-Link framing layer decoder
   - CRC16 validation
   - Escape sequence handling
   - Extracts embedded Habitat packets

3. **habitat-log-analyzer.js**
   - Main CLI with 8 commands
   - Stats, decode, session tracking, operations analysis
   - Works with bridge logs

4. **protocol-decoder.js**
   - Habitat binary protocol decoder
   - Decodes 4-byte headers (0x55, control, NOID, request)
   - Identifies 158 object classes
   - Maps 80+ operations

5. **log-parser.js**
   - Bridge log parser
   - Extracts JSON, binary, and connection events
   - Session grouping and filtering

6. **package.json + README.md**
   - Complete documentation
   - Usage examples
   - Protocol reference

## Protocol Layers Supported

### Layer 1: Q-Link Framing (NEW!)
**Log Source**: Docker container `neohabitat-qlink-1`
```
5A 01 4A 81 47 70 6F 20 55 E4 13 00 84 A0 01 0D
^^ ^^^^^^^^^^^ ^^^^^^^ ^^^^^^^^^^^^^^^^^^^ ^^
Z  CRC16       seq     Habitat payload     0x0D
```
- CRC16 validation (polynomial 0xA001)
- 4-byte encoded CRC
- Escape sequences (0x5D + XOR 0x55)
- Sequence numbers
- Frame end marker (0x0D)

### Layer 2: Habitat Protocol
**Log Source**: Bridge logs (bridge/bridge.log)
```
55 E4 13 00 84 A0 01
^^ ^^ ^^ ^^ ^^^^^^^^^
|  |  |  |  payload
|  |  |  request#
|  |  NOID
|  control (sequence + flags)
Microcosm ID
```
- Region operations (NOID=0): ENSEMBLE, I_AM_HERE, NEWREGION, etc.
- Object operations (NOID>0): WALK, SPEAK, TOUCH, GET, etc.
- Binary state encoding
- Packet splitting for large messages

### Layer 3: Elko JSON
**Log Source**: Bridge logs
```json
{"to":"context-Downtown_5h","op":"make","obj":{...}}
```
- Modern JSON protocol
- Context management
- Object state
- User actions

## Key Features

### Session Analyzer (session-analyzer.js)

**Capabilities**:
- Correlates logs from multiple sources
- Tracks complete user sessions from login to disconnect
- Shows chronological message flow
- Identifies both Q-Link and Bridge activity
- Filters by username and datetime

**Usage**:
```bash
# Latest session for any user (live from server)
./session-analyzer.js "" latest

# All sessions for chalcedony
./session-analyzer.js chalcedony

# Latest session for modeki with details
./session-analyzer.js modeki latest --verbose

# Use local log files
./session-analyzer.js --qlink qlink.log --bridge bridge.log
```

**Example Output**:
```
════════════════════════════════════════════════════════════════════════════════
SESSION: chalcedony
Started: 2025-12-23T12:41:33.523Z
Ended:   2025-12-23T12:58:15.155Z
Q-Link entries: 127
Bridge entries: 543
════════════════════════════════════════════════════════════════════════════════

[12:41:33.523] [QLINK] LOGIN: chalcedony
[12:41:33.524] [QLINK] → Q-Link Packet
  CRC: 0x0A87 ✓
  Payload: 10 bytes
  → Habitat: POSTURE (NOID 19, seq 112)
[~0001] [BRIDGE] ← JSON: make
[~0002] [BRIDGE] → Client: I_AM_HERE (NOID 0, seq 2)
[12:41:34.024] [QLINK] ← Q-Link Packet
  CRC: 0x0A91 ✓
  → Habitat: NEWREGION (NOID 19, seq 113)
...
```

### Q-Link Decoder (qlink-decoder.js)

**Capabilities**:
- Decodes Q-Link packet structure
- Validates CRC16 checksums
- Handles escape sequences
- Extracts and decodes embedded Habitat packets
- Parses Q-Link log format

**Usage**:
```bash
# Decode packet from hex
./qlink-decoder.js "5A 01 4A 81 47 70 6F 20 55 E4 13 00 84 A0 01 0D"

# Parse from log file
grep "Sending packet" qlink.log | ./qlink-decoder.js
```

### Habitat Analyzer (habitat-log-analyzer.js)

**8 Commands**:
1. `stats` - Log file statistics
2. `decode` - Decode binary packets
3. `session` - Show session messages
4. `trace` - Request/response pairs
5. `operations` - List operation types
6. `contexts` - List regions
7. `grep` - Search patterns
8. `protocol` - Protocol reference

## Log Sources

### Production Server (neohabitat)

**Docker Containers**:
```bash
# Q-Link logs (framing layer)
ssh neohabitat "sudo docker logs --tail 5000 neohabitat-qlink-1 2>&1" > qlink.log

# Bridge logs (Habitat + Elko)
ssh neohabitat "tail -10000 ~/neohabitat/bridge/bridge.log" > bridge.log

# Elko server logs (high-level events)
ssh neohabitat "tail -10000 ~/neohabitat/elko_server.log" > elko.log
```

**Log Sizes** (production):
- bridge.log: ~1-2 MB/day
- qlink container: ~100K lines/day
- elko_server.log: ~90 MB total

## Testing

All tools tested with production log samples:
- `qlink-sample.log`: 5,000 lines, 14 user sessions
- `bridge-sample.log`: 10,000 lines, 169 sessions

**Test Results**:
```bash
$ ./session-analyzer.js katnap --qlink qlink-sample.log --bridge bridge-sample.log
Found 3 matching sessions
- Session 1: 5 Q-Link entries, 63 Bridge entries
- Session 2: 12 Q-Link entries, 89 Bridge entries
- Session 3: 8 Q-Link entries, 41 Bridge entries
```

## Common Workflows

### Debugging a User Issue

1. **Get latest session**:
   ```bash
   ./session-analyzer.js username latest --verbose
   ```

2. **Find specific operation**:
   ```bash
   ./habitat-log-analyzer.js grep bridge.log WALK
   ```

3. **Decode suspicious packet**:
   ```bash
   ./qlink-decoder.js "5A 01 4A 81 47..."
   ```

### Analyzing Protocol Behavior

1. **See all operations used**:
   ```bash
   ./habitat-log-analyzer.js operations bridge.log
   ```

2. **Track context changes**:
   ```bash
   ./habitat-log-analyzer.js grep bridge.log NEWREGION
   ```

3. **Validate Q-Link CRCs**:
   ```bash
   grep "Sending packet" qlink.log | ./qlink-decoder.js | grep "✗"
   ```

### Performance Analysis

1. **Session statistics**:
   ```bash
   ./habitat-log-analyzer.js stats bridge.log
   ```

2. **Message frequency**:
   ```bash
   ./session-analyzer.js username | grep WALK | wc -l
   ```

## Technical Details

### CRC16 Implementation
- Polynomial: 0xA001
- 4-byte encoding for Q-Link packets
- Validation on all received packets
- Source: `/home/randy/qlink/src/main/java/org/jbrain/qlink/util/CRC16.java`

### Escape Sequences
- Escape char: 0x5D
- XOR value: 0x55
- Applied to: 0x0D (frame end) and 0x5D (escape char itself)

### Timestamp Handling
- Q-Link logs: ISO timestamps with milliseconds
- Bridge logs: No native timestamps (estimated from order)
- Session analyzer: Merges by timestamp when available

### Username Extraction
- Q-Link: From login events and packet headers
- Bridge: From session identifiers (e.g., "2087:Chalcedony")
- Case-insensitive matching

## Files Created

```
tools/log-parser/
├── session-analyzer.js      ⭐ 450 lines - Multi-log correlator
├── qlink-decoder.js          ⭐ 350 lines - Q-Link layer decoder
├── habitat-log-analyzer.js      340 lines - Main CLI tool
├── protocol-decoder.js          280 lines - Habitat decoder
├── log-parser.js                260 lines - Bridge parser
├── package.json                  20 lines - Package config
├── README.md                    300 lines - Complete docs
├── SUMMARY.md                   This file
├── bridge-sample.log         1.2 MB - Sample data
└── qlink-sample.log          500 KB - Sample data
```

**Total**: ~2,000 lines of code, comprehensive documentation

## Related Documentation

- `/home/randy/neohabitat/PROTOCOL.md` - Complete protocol specification (1,112 lines)
- `/home/randy/neohabitat/README.md` - Project overview
- `/home/randy/qlink/reference/` - Q-Link protocol reverse engineering notes

## Future Enhancements

Possible improvements:
- Real-time log streaming
- Web-based visualization
- Packet replay capability
- Protocol fuzzing tools
- Performance metrics dashboard
- Automated issue detection

## Credits

Built using:
- NeoHabitat bridge implementation
- Q-Link Reloaded server
- Original Q-Link protocol reverse engineering
- Habitat protocol documentation

All tools are open source and documented for community use.
