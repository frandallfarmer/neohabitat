# Habitat Log Parser

Debugging tools for parsing and analyzing NeoHabitat server logs. These tools help decode the binary Habitat protocol and trace message flows between clients and servers.

## Overview

The NeoHabitat server logs contain a mix of:
- **Binary Habitat packets** - Raw protocol bytes in arrays like `[85,236,0,1,...]`
- **JSON messages** - Elko server messages
- **Connection events** - Client connections and disconnections
- **User registration** - Avatar assignments to regions

These tools parse all of these formats and provide analysis capabilities.

## Installation

```bash
cd tools/log-parser
chmod +x *.js
```

## Tools

### session-analyzer.js

**Multi-log session analyzer** - Correlates Q-Link and Bridge logs to show complete user session activity.

```bash
# Latest session for any user
./session-analyzer.js "" latest

# All sessions for a specific user
./session-analyzer.js chalcedony

# Latest session for specific user
./session-analyzer.js modeki latest

# Use local log files
./session-analyzer.js --qlink qlink.log --bridge bridge.log

# Verbose mode shows packet details
./session-analyzer.js chalcedony latest --verbose
```

**Output**: Chronologically ordered timeline showing:
- Q-Link framing layer (CRC, sequence numbers, ACKs, keepalives)
- Habitat protocol messages (binary packets) with decoded text for SPEAK/OBJECT_TALKS
- Elko JSON messages with decoded text for SPEAK$/OBJECTSPEAK_$
- Connection events
- Time-synchronized interlacing (Bridge timestamps matched to Q-Link packets)

### habitat-log-analyzer.js

Main command-line tool for analyzing individual log files.

#### Commands

**stats** - Show log file statistics
```bash
./habitat-log-analyzer.js stats bridge.log
```

**decode** - Decode a binary packet
```bash
./habitat-log-analyzer.js decode "85,236,0,1,0,0,32,0,11"
```

**session** - Show all messages for a specific session
```bash
./habitat-log-analyzer.js session bridge.log "2087:Chalcedony"
```

**trace** - Trace request/response pairs for a session
```bash
./habitat-log-analyzer.js trace bridge.log "2087:Chalcedony"
```

**operations** - List all operation types seen in the log
```bash
./habitat-log-analyzer.js operations bridge.log
```

**contexts** - List all contexts/regions accessed
```bash
./habitat-log-analyzer.js contexts bridge.log
```

**grep** - Search for specific operations or patterns
```bash
./habitat-log-analyzer.js grep bridge.log WALK
./habitat-log-analyzer.js grep bridge.log "Downtown_5h"
```

**protocol** - Show protocol reference
```bash
./habitat-log-analyzer.js protocol
./habitat-log-analyzer.js protocol region
./habitat-log-analyzer.js protocol object
```

### protocol-decoder.js

Standalone protocol decoder for binary packets.

```bash
# Decode a packet
./protocol-decoder.js "85,250,0,18,11"

# Pipe from grep
grep "\[85," bridge.log | ./protocol-decoder.js
```

### log-parser.js

Programmatic log parser (Node.js module).

```bash
# Parse with options
./log-parser.js bridge.log --stats
./log-parser.js bridge.log --session "2087:Chalcedony"
./log-parser.js bridge.log --type binary-to-client --json
```

## Usage Examples

### Debugging a User Session

1. Find active sessions:
```bash
./habitat-log-analyzer.js stats bridge.log
```

2. View all messages for that session:
```bash
./habitat-log-analyzer.js session bridge.log "2087:Chalcedony"
```

3. Trace request/response pairs:
```bash
./habitat-log-analyzer.js trace bridge.log "2087:Chalcedony"
```

### Analyzing Protocol Operations

1. See what operations are being used:
```bash
./habitat-log-analyzer.js operations bridge.log
```

2. Find all instances of a specific operation:
```bash
./habitat-log-analyzer.js grep bridge.log WALK
./habitat-log-analyzer.js grep bridge.log NEWREGION
```

### Decoding Binary Packets

From the logs, you might see:
```
debug: [85,250,0,18,11] -> client (2087:Chalcedony)
```

Decode it:
```bash
./habitat-log-analyzer.js decode "85,250,0,18,11"
```

Output:
```
[10] NOID 0 APPEARING_$
  Raw: [85, 250, 0, 18, 11]
  Hex: 55 FA 00 12 0B
  Control: 0xFA (seq=10, split=ME)
  NOID: 0 (Region)
  Request: 18
  Payload (1 bytes): [11]
  Payload hex: 0B
```

### Finding Context Changes

```bash
./habitat-log-analyzer.js grep bridge.log NEWREGION
./habitat-log-analyzer.js contexts bridge.log
```

## Protocol Reference

See `../../PROTOCOL.md` for complete protocol documentation.

### Quick Reference

**Region Operations (NOID = 0):**
- 1: DESCRIBE (ENSEMBLE packet - region/object description)
- 2: I_QUIT
- 3: IM_ALIVE
- 4: CUSTOMIZE
- 5: FINGER_IN_QUE (catchup in progress)
- 6: HERE_I_AM (materialize)
- 7: PROMPT_REPLY
- 8: HEREIS
- 9: GOAWAY (object has left)
- 10: PORT (avatar moved)
- 11: UPDATE_DISK
- 12: FIDDLE (modify object properties)
- 13: LIGHTING (change light level)
- 14: MUSIC (play a tune)
- 15: OBJECT_TALKS (automated NPC/object speech - decoded as text)
- 16: WAIT_FOR_ANI (wait for animation)
- 17: CAUGHT_UP (catchup complete)
- 18: APPEAR
- 19: CHANGE_CONT
- 20: PROMPT_USER
- 21: BEEN_MOVED
- 22: HOST_DUMP

**Object Operations (NOID > 0):**
- 0: TOUCH
- 4: READ
- 6: POSTURE
- 7: SPEAK (user speech - decoded as text with ESP flag)
- 8: WALK
- 10: GET

**Decoded Text Operations:**
- SPEAK: Client speech (byte 0 = ESP flag, bytes 1+ = text)
- OBJECT_TALKS: NPC/object automated speech (byte 0 = speaker, bytes 1+ = text)
- SPEAK$ (JSON): Broadcast speech from other users (includes noid and text)
- OBJECTSPEAK_$ (JSON): Object-initiated announcements (includes speaker and text)

### Packet Format

```
[0x55] [Control] [NOID] [Request#] [Payload...]

Control byte:
  Bit 7: Split End
  Bit 6: Split Mid
  Bit 5: Split Start
  Bits 0-3: Sequence number
```

## Log Formats

### Binary Packet (Server → Client)
```
debug: [85,236,0,1,0,0,32,0,11,...] -> client (2087:Chalcedony)
```

### Client Request
```
debug: client (2087:Chalcedony) -> [noid:14 request:8 seq:10 ... [24,160,1]]
```

### Server JSON
```
debug: server (2087:Chalcedony) -> {"to":"context-Downtown_5h","op":"make",...}
```

### Connection Events
```
debug: Connecting: 172.18.0.4:1337 <-> 172.18.0.4:57832
debug: Habitat client disconnected.
```

## Programmatic Usage

```javascript
const decoder = require('./protocol-decoder');
const parser = require('./log-parser');

// Decode a packet
const bytes = [85, 250, 0, 18, 11];
const decoded = decoder.decodePacket(bytes);
console.log(decoder.formatPacket(decoded, true));

// Parse log file
parser.parseLogFile('bridge.log', entry => {
    if (entry.type === 'binary-to-client') {
        console.log(entry.decoded.operation);
    }
}).then(stats => {
    console.log(`Parsed ${stats.total} lines`);
});
```

## Remote Log Analysis

To analyze logs from the production server:

```bash
# Download bridge logs (Habitat protocol layer)
scp neohabitat:neohabitat/bridge/bridge.log ./

# Download Q-Link logs (Q-Link framing layer) - requires Docker access
ssh neohabitat "sudo docker logs --tail 5000 neohabitat-qlink-1 2>&1" > qlink.log

# Analyze Q-Link packets
./qlink-decoder.js "5A 01 4A 81 47 ..."
grep "Sending packet data" qlink.log | head -10
```

The system runs in Docker with these components:
- **neohabitat** container: Bridge, Elko server, Pushserver
- **qlink** container: Q-Link Reloaded server (Java)
- **neohabitatmongo** container: MongoDB database

## Files

- `session-analyzer.js` - **NEW!** Multi-log session analyzer (Q-Link + Bridge)
- `habitat-log-analyzer.js` - Main CLI tool for individual logs
- `qlink-decoder.js` - **NEW!** Q-Link framing layer decoder (CRC16, escape sequences)
- `protocol-decoder.js` - Habitat binary packet decoder
- `log-parser.js` - Bridge log file parser
- `package.json` - Package metadata
- `README.md` - This file
- `bridge-sample.log` - Sample Bridge log (10K lines)
- `qlink-sample.log` - Sample Q-Link log (5K lines)

## Troubleshooting

**"Unknown packet" errors**: The packet may be corrupted or incomplete. Check the raw hex dump.

**Session not found**: Make sure to quote session names that contain colons:
```bash
./habitat-log-analyzer.js session bridge.log "2087:Chalcedony"
```

**Large log files**: Use `grep` or `tail` to reduce the input:
```bash
tail -10000 bridge.log | ./log-parser.js --stats
```

## See Also

- `../../PROTOCOL.md` - Complete Habitat/Q-Link protocol documentation
- `../../bridge/Habitat2ElkoBridge.js` - Bridge implementation
- `../../bridge/hcode.js` - Protocol constants and encoders
