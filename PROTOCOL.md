# NeoHabitat Protocol Documentation

## Overview

This document describes the Habitat application protocol and Q-Link framing layer used by NeoHabitat. The protocol enables communication between C64 Habitat clients and the modern Elko-based server through a bidirectional translation bridge.

**Key Points**:
- Binary protocol originally designed for 1200 baud modems over X.25 packet networks
- Modern implementation uses TCP/IP for transport
- Q-Link framing provides packet delimiting and escape sequences
- Habitat application protocol uses 4-byte headers with variable payloads
- Bridge translates between binary Habitat protocol and JSON Elko messages

---

## Protocol Stack Architecture

```
┌─────────────────────────────────────────────────┐
│         C64 Habitat Client                      │
│         (Binary Habitat Protocol)               │
└─────────────────┬───────────────────────────────┘
                  │ Binary packets over TCP/IP
                  │ (RS-232 at 1200 baud simulated)
┌─────────────────▼───────────────────────────────┐
│         Q-Link Framing Layer                    │
│    - Username:Z<packet> format                  │
│    - Byte stuffing (escape 0x0D, 0x5D)          │
│    - 20-byte overhead per packet                │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│    Habitat2ElkoBridge (Node.js)                 │
│    - Translates Binary ↔ JSON                   │
│    - Manages NOID assignments                   │
│    - Throttles to 1200 baud timing              │
│    - Splits large messages (>100 bytes)         │
└─────────────────┬───────────────────────────────┘
                  │ JSON over line-delimited frames
┌─────────────────▼───────────────────────────────┐
│         Elko Server (Java)                      │
│    - Modern game logic                          │
│    - MongoDB persistence                        │
│    - Context/region management                  │
└─────────────────────────────────────────────────┘
```

### Service Ports

- **1986**: Modern direct bridge connection (recommended)
- **5190**: Legacy Q-Link connection method (deprecated)
- **1337**: Bridge internal listening port
- **9000**: Elko server port
- **27017**: MongoDB
- **3307**: MariaDB/MySQL

---

## Q-Link Framing Layer

### Historical Context

QuantumLink (Q-Link) was an online service for Commodore 64 launched in 1985. The Q-Link protocol provided:
- Reliable packet delivery over 300-1200 baud modems
- CRC error detection
- Packet sequencing and retransmission
- Flow control via windowing

NeoHabitat uses Q-Link Reloaded, a modern Java-based reimplementation of the Q-Link server.

### Q-Link Packet Structure

Original Q-Link packets have this format:

```
┌────┬────────────┬─────────────┬────┐
│0x5A│    CRC     │   Payload   │0x0D│
│ Z  │ (4 bytes)  │  (variable) │ CR │
└────┴────────────┴─────────────┴────┘
```

**For Habitat, the full structure is**:

```
┌──────────────┬────┬────────────┬──────┬────┬────┬─────────────┬────┐
│ Username:    │0x5A│    CRC     │ 0x55 │Ctrl│NOID│  Payload    │0x0D│
│              │ Z  │ (4 bytes)  │      │    │    │             │ CR │
└──────────────┴────┴────────────┴──────┴────┴────┴─────────────┴────┘
  User prefix   ←─ Q-Link Wrapper ─→  ←─── Habitat Packet ────→
```

### Frame Detection

The bridge detects three framing modes (`Habitat2ElkoBridge.js:676-679`):

```javascript
UNKNOWN_FRAME     = 0  // Initial state
DELIMITED_FRAME   = 1  // JSON (lf-lf delimited)
QLR_FRAME         = 2  // NAME:QLINKPACKET format
QLINK_FRAME       = 3  // Binary Q-Link packets
```

### Client Connection Format

**Client → Bridge packets** start with:
- Username string followed by `:` (colon)
- Then `Z` (0x5A) character marking Q-Link data start
- CRC checksum (4 bytes, special encoding)
- Binary Habitat packet (escaped)
- End-of-message marker (0x0D, escaped if needed)

**Example**: `"Randy:Z<crc><binary_habitat_packet><0x0D>"`

### Q-Link Packet Constants

```java
CMD_START = 0x5A    // 'Z' - marks start of Q-Link packet
FRAME_END = 0x0D    // Carriage return - marks end of packet
```

### Escape Sequences

Q-Link uses byte-stuffing to avoid conflicts with control characters.

**Characters requiring escaping**:
- `0x0D` (carriage return / END_OF_MESSAGE)
- `0x5D` (escape character itself)
- `0x00` (null, optional)

**Escape algorithm** (`Habitat2ElkoBridge.js:322-334`):
1. When encountering a byte that needs escaping
2. Insert ESCAPE_CHAR (`0x5D`)
3. XOR the original byte with `0x55` (ESCAPE_XOR)

**Constants**:
```javascript
ESCAPE_CHAR    = 0x5D
END_OF_MESSAGE = 0x0D
ESCAPE_XOR     = 0x55
```

**Examples**:
- Byte `0x0D` → Escaped as `[0x5D, 0x58]` (0x0D ^ 0x55 = 0x58)
- Byte `0x5D` → Escaped as `[0x5D, 0x08]` (0x5D ^ 0x55 = 0x08)
- Byte `0x00` → Escaped as `[0x5D, 0x55]` (0x00 ^ 0x55 = 0x55)

**Descape algorithm**:
```javascript
function descape(buffer) {
    result = []
    for each byte in buffer:
        if byte == ESCAPE_CHAR:
            next_byte = read next byte
            result.append(next_byte ^ ESCAPE_XOR)
        else:
            result.append(byte)
    return result
}
```

### Packet Overhead

```javascript
PACKETOVERHEAD = 20  // Bytes added by Q-Link Protocol and Framing
```

This overhead is used for calculating transmission timing at 1200 baud.

---

### Q-Link CRC Algorithm

Q-Link uses a 16-bit CRC for error detection with polynomial `0xA001` (CRC16.java:31).

**Algorithm** (from original C64 disassembly):

```java
int crc = 0;
int poly = 0xA001;

for each byte in payload:
    for (int bit = 0; bit < 8; bit++) {
        crc = crc ^ (byte & 1);    // XOR with low bit of data
        byte = byte >> 1;           // Shift data right

        if ((crc & 1) != 0) {       // If CRC low bit is set
            crc = crc >> 1;         // Shift CRC right
            crc = crc ^ poly;       // XOR with polynomial
        } else {
            crc = crc >> 1;         // Just shift CRC right
        }
    }
}
```

**CRC Encoding** (from qlink protocol.txt):

The 16-bit CRC is encoded into 4 bytes for transmission:

```
CRC = 0x3E82  (example)

A = (crc & 0x00F0) | 0x01 = 0x81
B = (crc & 0x000F) | 0x40 = 0x42
C = (crc & 0xF000) >> 12 | 0x01 = 0x31
D = (crc & 0x0F00) >> 8 | 0x40 = 0x4E

Transmitted as: 0x5A 0x81 0x42 0x31 0x4E <payload> 0x0D
```

Each CRC nibble is encoded with specific OR masks:
- Low nibbles: OR with 0x01
- High nibbles: OR with 0x40

This encoding ensures all CRC bytes are printable ASCII (avoiding control characters).

**Example Packet**:

```
Raw payload: 0x7F 0x7F 0x23 0x05 0x09
CRC16: 0x3E82
Encoded CRC: [0x81, 0x42, 0x31, 0x4E]

Full packet: 0x5A 0x81 0x42 0x31 0x4E 0x7F 0x7F 0x23 0x05 0x09 0x0D
```

---

## Habitat Application Protocol

### Binary Packet Format

Every Habitat packet has this structure:

```
Offset  Size  Field           Description
──────────────────────────────────────────────────────────
0       1     Magic           0x55 (MICROCOSM_ID_BYTE / '|')
1       1     Control         Bit 7: END (0x80)
                              Bit 6: MIDDLE (0x40) - always set
                              Bit 5: START (0x20)
                              Bits 0-4: Sequence (0-31)
2       1     NOID            Network Object ID (target)
3       1     Request         Message type/operation number
4+      N     Payload         Variable-length arguments
```

### Header Breakdown

**Byte 0: Magic Number**
```
0x55 = MICROCOSM_ID_BYTE (also ASCII '|')
```
This signature identifies Habitat protocol packets.

**Byte 1: Control Byte** (`Habitat2ElkoBridge.js:816-823`)

Bit layout:
```
 7   6   5   4   3   2   1   0
┌───┬───┬───┬───┬───┬───┬───┬───┐
│END│MID│STR│ Sequence Number   │
└───┴───┴───┴───┴───┴───┴───┴───┘
```

- **Bit 7 (0x80)**: END flag - last packet in message
- **Bit 6 (0x40)**: MIDDLE flag - always set in Habitat
- **Bit 5 (0x20)**: START flag - first packet in message
- **Bits 0-4**: Sequence number (0-31) for request/reply matching

**Special Sequence Numbers**:
- `0xFA` (`PHANTOM_REQUEST`): Server-initiated message with no client request
- `0x1A`: Async packet sequence number

**Byte 2: NOID (Network Object ID)**

Identifies the target object for the message.

**Special NOIDs**:
```javascript
REGION_NOID     = 0    // Messages to/from the region itself
UNASSIGNED_NOID = 256  // Ghost avatars (not rendered)
```

**Byte 3: Request Number**

Identifies the message type/operation. Each object class defines which request numbers it responds to.

### Packet Splitting

Large messages are split into chunks (`hcode.js:16-20`):

```javascript
MAX_PACKET_SIZE = 100  // Maximum payload size in bytes

SPLIT_START  = 0x20    // First packet in sequence
SPLIT_MIDDLE = 0x40    // Middle packet (always set)
SPLIT_END    = 0x80    // Last packet in sequence
```

**Multi-packet message control byte patterns**:
- **Single packet**: `START | MIDDLE | END` = `0xE0`
- **First of many**: `START | MIDDLE` = `0x60`
- **Middle packet**: `MIDDLE` = `0x40`
- **Last packet**: `MIDDLE | END` = `0xC0`

Example splitting sequence (`Habitat2ElkoBridge.js:486-509`):
```javascript
if (payload_length > MAX_PACKET_SIZE) {
    for (start = 0; start < payload.length; start += MAX_PACKET_SIZE) {
        chunk = payload.slice(start, start + MAX_PACKET_SIZE)
        control = seq | SPLIT_MIDDLE
        if (start == 0) control |= SPLIT_START
        if (chunk.length < MAX_PACKET_SIZE) control |= SPLIT_END
        send_packet(header | control, chunk)
    }
}
```

---

## Message Types

### Region-Level Messages

Messages with `NOID = 0` (REGION_NOID) control region/session state (`hcode.js:25-47`):

```
Message ID  Name                Description
──────────────────────────────────────────────────────────
1           DESCRIBE            Request region contents vector
2           I_QUIT              Client disconnect notification
3           IM_ALIVE            Keepalive/connection acknowledgment
4           CUSTOMIZE           Avatar customization
5           FINGER_IN_QUE       Catchup phase signal
6           HERE_I_AM           Avatar materialization complete
7           PROMPT_REPLY        User input response
8           HEREIS              Object arrival notification
9           GOAWAY              Object departure notification
10          PORT                Avatar region transition
11          UPDATE_DISK         Save state to disk
12          FIDDLE              Modify object property
13          LIGHTING            Change light level
14          MUSIC               Play sound effect
15          OBJECT_TALKS        Object speech/text display
16          WAIT_FOR_ANI        Wait for animation completion
17          CAUGHT_UP           Region synchronization complete
18          APPEAR              Object appearing animation
19          CHANGE_CONT         Change object container
20          PROMPT_USER         Prompt for user input
21          BEEN_MOVED          Forced movement notification
22          HOST_DUMP           Debug dump request
```

### Object-Level Messages

Messages directed at specific objects use the object's NOID (`hcode.js:49-107`):

```
Request#  Operation       Common Objects
──────────────────────────────────────────────────
0         HELP            All objects
1         GET             Portable items
2         PUT             Portable items
3         THROW           Portable items
4         Various         Object-specific (CLOSE, MAGIC, etc.)
5         Various         Object-specific (OPEN, ON, etc.)
6         POSTURE         Avatar
7         SPEAK           Avatar
8         WALK            Avatar, Ghost
9         NEWREGION       Avatar, Ghost
10        DISCORPORATE    Avatar
11        ESP             Avatar
```

### Client Message Definitions by Class

Each object class defines which messages it responds to (`hcode.js:997-1548`).

**Example: Avatar**
```javascript
Avatar: {
    clientMessages: {
        0:  { op:"HELP" },
        4:  { op:"GRAB" },
        5:  { op:"HAND" },
        6:  { op:"POSTURE" },
        7:  { op:"SPEAK" },
        8:  { op:"WALK" },
        9:  { op:"NEWREGION" },
        10: { op:"DISCORPORATE" },
        11: { op:"ESP" },
        12: { op:"SITORSTAND" },
        13: { op:"TOUCH" },
        14: { op:"FNKEY" }
    }
}
```

**Example: Portable Container (Bag, Box, etc.)**
```javascript
portableContainer: {
    clientMessages: {
        0: { op:"HELP" },
        1: { op:"GET" },
        2: { op:"PUT" },
        3: { op:"THROW" },
        4: { op:"CLOSECONTAINER" },
        5: { op:"OPENCONTAINER" }
    }
}
```

---

## Object Classes

158 object classes are defined, each with a unique class number (`hcode.js:419-525`):

```
Class#  Name                Class#  Name
────────────────────────────────────────────
0       Region              37      Gun
1       Avatar              42      Key
2       Amulet              54      Paper
3       Ghost               55      Plaque
4       Atm                 56      Short_sign
5       Game_piece          57      Sign
6       Bag                 74      Teleport
7       Ball                76      Tokens
10      Book                80      Wall
12      Bottle              84      Changomatic
13      Box                 85      Vendo_front
16      Club                86      Vendo_inside
17      Compass             87      Trapezoid
23      Door                90      Sex_changer
27      Fake_gun            91      Stun_gun
28      Elevator            127     Head
29      Flag                129     Aquarium
30      Flashlight          130     Bed
35      Grenade             134     Chair
36      Ground              140     Fortune_machine
...     ...                 158     Bureaucrat
```

### Class Inheritance

Classes inherit message handlers through shared definitions:

- **portable**: `GET, PUT, THROW, HELP`
- **portableContainer**: `GET, PUT, THROW, OPENCONTAINER, CLOSECONTAINER, HELP`
- **document**: `READ, HELP`
- **magical**: `GET, PUT, THROW, MAGIC, HELP`
- **weapon**: `GET, PUT, ATTACK, HELP`
- **help**: `HELP` only

---

## Server Operations

The bridge defines 80+ server-to-client operations (`hcode.js:109-417`):

```javascript
SERVER_OPS = {
    "OBJECTSPEAK_$": { reqno: 15,
        toClient: function (o,b) {
            b.add(o.speaker);
            b.add(o.text.substring(0, 114).getBytes());
        }
    },
    "WALK$": { reqno: 8,
        toClient: function (o,b) {
            b.add(o.x);
            b.add(o.y);
            b.add(o.how);
        }
    },
    "ATTACK$": { reqno: 9,
        toClient: function (o, b) {
            b.add(o.ATTACK_TARGET);
            b.add(o.ATTACK_DAMAGE);
        }
    }
    // ... 80+ more operations
}
```

Each operation defines:
- **reqno**: Request number (byte 3 of header)
- **toClient**: Function to encode JSON from Elko into binary for C64

---

## State Encoding

Objects serialize their state as byte arrays (`Habitat2ElkoBridge.js:935-1222`).

### Common State (All Objects)

```
Offset  Field           Size    Description
────────────────────────────────────────────────
0       style           1       Visual style/variant
1       x               1       X position
2       y               1       Y position
3       orientation     1       Rotation/facing
4       gr_state        1       Graphic state index
5       container       1       Container NOID
```
**Total: 6 bytes**

### Region State

```
Offset  Field           Size    Description
────────────────────────────────────────────────
0       terrain_type    1       Ground type
1       lighting        1       Light level (0-3)
2       depth           1       Y-depth (usually 32)
3       region_class    1       Region classification
4       Who_am_I        1       Avatar NOID (or 255=ghost)
5-8     bankBalance     4       Avatar's bank balance
```
**Total: 9 bytes**

### Avatar State (Extends Common)

```
Common 6 bytes (style, x, y, orientation, gr_state, container)
+
Offset  Field           Size    Description
────────────────────────────────────────────────
6       activity        1       Current activity
7       action          1       Current action
8       health          1       Health (0-255, usually 255)
9       restrainer      1       Restraining object NOID
10-11   custom          2       Avatar customization colors
```
**Total: 12 bytes**

### Specialized Encodings

**Openable** (extends Common +3 bytes):
```
6       open_flags      1       Open/closed state
7       key_lo          1       Key number low byte
8       key_hi          1       Key number high byte
```

**Magical** (extends Common +1 byte):
```
6       magic_type      1       Magic effect type
```

**Toggle** (extends Common +1 byte):
```
6       on              1       On/off state
```

**Tokens** (extends Common +2 bytes):
```
6       denom_lo        1       Token value low byte
7       denom_hi        1       Token value high byte
```

**Key** (extends Common +2 bytes):
```
6       key_number_lo   1       Key ID low byte
7       key_number_hi   1       Key ID high byte
```

---

## Connection Handshake Sequence

Typical connection flow (`Habitat2ElkoBridge.js:756-914`):

### 1. Initial Connection

**Client** → Bridge:
```
"Randy:Z..."
```
Username string with colon, followed by 'Z' marker.

### 2. User Database Check

**Bridge** checks MongoDB for user, creates if needed with:
- Random avatar position (y: 128-159)
- Random customization colors
- Bank balance: 50,000 tokens
- Default items: Head, Paper, Tokens

### 3. Alive Handshake

**Client** → Bridge:
```
[0x55, seq|0x60, 0x00, 0x03, ...]
       ^         ^     ^
       |         |     MESSAGE_IM_ALIVE (3)
       |         REGION_NOID (0)
       seq|START|MIDDLE
```

**Bridge** → Client:
```
[0x55, 0xFA, 0x00, 0x03, 0x01, 0x30, 'B','A','D',' ','D','I','S','K']
       ^     ^     ^     ^     ^     ^
       |     |     |     |     |     "BAD DISK" message (ignored)
       |     |     |     |     SUCCESS (1)
       |     |     |     MESSAGE_IM_ALIVE reply
       |     |     REGION_NOID
       |     PHANTOM_REQUEST (no client seq)
       Magic byte
```

### 4. Region Request

**Client** → Bridge:
```
[0x55, seq|0xE0, 0x00, 0x01]
       ^         ^     ^
       |         |     MESSAGE_DESCRIBE (1)
       |         REGION_NOID
       seq|START|MIDDLE|END
```

### 5. Enter Context

**Bridge** → Elko Server:
```json
{
    "to": "session",
    "op": "entercontext",
    "context": "context-hatchery",
    "user": "user-randy"
}
```

### 6. Region Population

**Elko** → Bridge (multiple messages):
```json
// Region object
{"op":"make", "obj":{"type":"item", "mods":[{"type":"Region", ...}]}}

// Avatar object
{"op":"make", "you":true, "obj":{"type":"user", "mods":[{"type":"Avatar", ...}]}}

// Contents (other avatars, items)
{"op":"make", "obj":{"type":"item", "mods":[{"type":"Box", ...}]}}
...

// Ready signal
{"op":"ready"}
```

### 7. Contents Vector Reply

**Bridge** accumulates all objects and sends complete region state:

```
[0x55, seq|0xE0, 0x00, 0x01, <Region State>, <Class List>, 0x00, <State Bundles>, 0x00]
       ^         ^     ^     ^               ^             ^     ^               ^
       |         |     |     |               |             |     |               Terminator
       |         |     |     |               |             |     Object states concatenated
       |         |     |     |               |             Terminator
       |         |     |     |               [noid1,class1,noid2,class2,...]
       |         |     |     9 bytes of Region state
       |         |     MESSAGE_DESCRIBE reply
       |         REGION_NOID
       seq|START|MIDDLE|END
```

**Contents Vector Format**:
1. Region state (9 bytes)
2. Object class list (pairs of noid, class_number)
3. Terminator (0x00)
4. State bundles (concatenated object states, ordered by container nesting)
5. Terminator (0x00)

Objects are ordered so containers appear before their contents.

### 8. Client Renders

Client receives contents vector and renders the region with all objects.

---

## Protocol Translation Examples

### Client → Server (Binary to JSON)

**Binary packet** (Walk command):
```
[0x55, 0xE8, 0x01, 0x08, 0x50, 0x80, 0x02]
       ^     ^     ^     ^     ^     ^     ^
       |     |     |     |     |     |     how=2
       |     |     |     |     |     y=128
       |     |     |     |     x=80
       |     |     |     reqnum=8 (WALK)
       |     |     noid=1 (avatar)
       |     seq=8, START|MIDDLE|END (0xE8 = 0x08|0xE0)
       Magic
```

**Translated to JSON** (`Habitat2ElkoBridge.js:883-893`):
```json
{
  "to": "user-randy",
  "op": "WALK",
  "x": 80,
  "y": 128,
  "how": 2
}
```

### Server → Client (JSON to Binary)

**JSON from Elko**:
```json
{
  "op": "OBJECTSPEAK_$",
  "noid": 5,
  "speaker": 3,
  "text": "Hello!"
}
```

**Binary packet** (`hcode.js:229-238`):
```
[0x55, 0xFA, 0x05, 0x0F, 0x03, 0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x21]
       ^     ^     ^     ^     ^     ^------- "Hello!" in ASCII
       |     |     |     |     |
       |     |     |     |     speaker noid=3
       |     |     |     reqnum=15 (OBJECTSPEAK_$)
       |     |     noid=5 (object speaking)
       |     PHANTOM_REQUEST (0xFA)
       Magic
```

---

## Data Rate Throttling

The bridge simulates authentic C64 modem timing (`Habitat2ElkoBridge.js:357-361`):

```javascript
rate = 1200  // bits per second (default)
PACKETOVERHEAD = 20

function timeToXmit(bytes) {
    // Calculate milliseconds to transmit
    return (bytes + PACKETOVERHEAD) * 8 / rate * 1000
}
```

Messages are queued with delays (`Habitat2ElkoBridge.js:463-478`):

```javascript
function futureSend(connection, data) {
    var now = new Date().getTime()
    var when = connection.timeLastSent + timeToXmit(connection.lastSentLen)

    if (when <= now) {
        connection.write(data)
        connection.timeLastSent = now
    } else {
        var delay = when - now
        setTimeout(function() { connection.write(data) }, delay)
        connection.timeLastSent = when
    }
}
```

This ensures packets are sent at historically accurate intervals, preventing client buffer overruns.

---

## Debugging Protocol Issues

### Bridge Logging

The bridge uses Winston for detailed logging. Log levels:
- **error**: Critical failures
- **warn**: Recoverable issues
- **info**: Service events
- **debug**: Detailed protocol traces

### Log Patterns

**Client → Server** (`Habitat2ElkoBridge.js:826`):
```
client (<session>) -> [noid:<N> request:<R> seq:<S> ... [args]]
```

**Server → Client** (`Habitat2ElkoBridge.js:1384`):
```
server (<session>) -> <JSON>
```

**Binary → Client** (`Habitat2ElkoBridge.js:539`):
```
[<bytes>] -> client (<session>)
```

### Example Log Sequence

```
client (5:Randy) -> [noid:1 request:8 seq:5 ... [80,128,2]]
{"to":"user-randy","op":"WALK","x":80,"y":128,"how":2} -> server
server (5:Randy) -> {"op":"WALK$","noid":1,"x":80,"y":128,"how":2}
[85,225,1,8,80,128,2] -> client (5:Randy)
```

### Common Issues

#### 1. Malformed Packets
```
Badly formatted server message! Ignored: ...
```
**Cause**: Invalid JSON from Elko or corrupted binary from client
**Solution**: Check for protocol version mismatches

#### 2. JSON Parse Failures
```
JSON.parse failure client (...) -> Ignoring: ...
```
**Cause**: Incomplete JSON frame or non-JSON data
**Solution**: Verify line-delimited framing

#### 3. Unsupported Operations
```
*** Unsupported client message <reqnum> for <ref>. ***
```
**Cause**: Client sent operation not defined for object class
**Solution**: Check client code or add missing message handler

#### 4. NOID Reference Errors
```
Attempted to instantiate class '<type>' which is not supported.
```
**Cause**: Unknown object class in HCode definitions
**Solution**: Add class definition to hcode.js

#### 5. Escape Sequence Errors

**Symptom**: Framing breaks, messages truncated
**Cause**: Unescaped 0x0D or 0x5D in binary data
**Solution**: Verify escape/descape functions

### Packet Analysis Checklist

When debugging logs:

1. **Verify packet structure**:
   - First byte = `0x55`
   - Control byte has valid flags
   - NOID exists in client state
   - Request number valid for object class

2. **Check escape sequences**:
   - All `0x0D` and `0x5D` bytes escaped
   - Escaped bytes appear as `[0x5D, XOR'd value]`
   - Descape before interpreting payload

3. **Validate message flow**:
   - Region messages use NOID 0
   - Object messages use assigned NOIDs
   - Sequence numbers match requests
   - Contents vector includes all objects

4. **Timing issues**:
   - Bridge respects 1200 baud delays
   - Large messages split correctly
   - No buffer overruns on client

5. **Connection state**:
   - Handshake completed (IM_ALIVE)
   - Region entered (entercontext)
   - Contents vector received
   - Avatar NOID assigned

### Diagnostic Tools

**Packet Inspector** (hypothetical utility):
```javascript
function inspectPacket(bytes) {
    console.log("Magic:", bytes[0].toString(16))
    console.log("Control:", bytes[1].toString(16))
    console.log("  END:", (bytes[1] & 0x80) ? "yes" : "no")
    console.log("  START:", (bytes[1] & 0x20) ? "yes" : "no")
    console.log("  Seq:", bytes[1] & 0x0F)
    console.log("NOID:", bytes[2])
    console.log("Request:", bytes[3])
    console.log("Payload:", bytes.slice(4))
}
```

**Escape Validator**:
```javascript
function validateEscaping(bytes) {
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] == 0x0D || bytes[i] == 0x5D) {
            if (i == 0 || bytes[i-1] != 0x5D) {
                console.error("Unescaped byte at", i, ":", bytes[i].toString(16))
            }
        }
    }
}
```

---

## Protocol Constants Reference

### From hcode.js

```javascript
// Framing
MICROCOSM_ID_BYTE  = 0x55
ESCAPE_CHAR        = 0x5D
END_OF_MESSAGE     = 0x0D
ESCAPE_XOR         = 0x55

// Control byte flags
SPLIT_START        = 0x20
SPLIT_MIDDLE       = 0x40
SPLIT_END          = 0x80
SPLIT_MASK         = 0x1F  // Extracts sequence number

// Special values
PHANTOM_REQUEST    = 0xFA  // Server-initiated, no client seq
REGION_NOID        = 0     // Region/session messages
UNASSIGNED_NOID    = 256   // Ghost avatars

// Limits
MAX_PACKET_SIZE    = 100   // Maximum payload per packet
PACKETOVERHEAD     = 20    // Q-Link framing overhead
```

### Message Types (Partial List)

```javascript
// Region messages (NOID=0)
MESSAGE_DESCRIBE       = 1
MESSAGE_I_QUIT         = 2
MESSAGE_IM_ALIVE       = 3
MESSAGE_HEREIS         = 8
MESSAGE_GOAWAY         = 9
MESSAGE_FIDDLE         = 12
MESSAGE_LIGHTING       = 13
MESSAGE_OBJECT_TALKS   = 15

// Object messages (vary by class)
MESSAGE_get            = 1
MESSAGE_put            = 2
MESSAGE_throw          = 3
MESSAGE_walk           = 8
MESSAGE_newregion      = 9
MESSAGE_speak          = 7
```

---

## Q-Link Flow Control and Sequencing

### Packet Sequencing

Q-Link implements reliable delivery via sequence numbers (QConnection.java:55-69):

```java
SEQ_DEFAULT = 0x7F    // Initial sequence number
SEQ_LOW = 0x10        // Starting sequence after reset
QSIZE = 16            // Sliding window size (max unacknowledged)
```

**Sequence Flow**:
1. Both client and server start with `SEQ_DEFAULT` (0x7F)
2. After RESET/RESET_ACK exchange, sequences reset to `SEQ_LOW` (0x10)
3. Each Action packet increments the sequence: `SEQ_LOW` → `0x11` → `0x12` → ...
4. Sequence wraps after reaching maximum value

### Sliding Window Protocol

Q-Link uses a sliding window for flow control (QConnection.java:272-310):

**Window Size**: 16 packets (QSIZE)

**Send Logic**:
1. Queue outgoing Action packets
2. Send up to 16 unacknowledged packets
3. Stop sending when window is full
4. Start ping timer to check if client is responsive

**Receive Logic**:
1. Process incoming packet's receive sequence number
2. Free all sent packets up to and including that sequence
3. Slide window forward
4. Send more queued packets if space available

**Window Full Handling**:
- Client sends `WindowFull` command when buffer is full
- Server responds with `Ack` and pauses transmission
- Prevents buffer overflow on slow 1200 baud connections

### Keep-Alive and Ping

**Keep-Alive Timer** (QConnection.java:88-111):
- Scheduled every 60 seconds (configurable)
- Sends `Ping` command to client
- If no response within 60 seconds, closes connection
- Reset on any packet received

**Ping Timer** (QConnection.java:75-86):
- Activated when send queue backs up
- Fires every 2 seconds
- Prompts client to acknowledge received packets
- Helps drain send queue

### Error Handling

**CRC Errors**:
```
Server receives packet → CRC check fails → Send SequenceError
Client receives SequenceError → Retransmit all packets in window
```

**Sequence Errors**:
```
Expected sequence: 0x15
Received sequence: 0x17 (out of order)
Server sends SequenceError → Client retransmits from 0x15
```

**Maximum Consecutive Errors**: 20 (QConnection.java:43)
- Prevents infinite error loops
- Closes connection after threshold

---

## Additional Resources

### Source Files

**NeoHabitat Bridge**:
- **bridge/Habitat2ElkoBridge.js**: Main protocol bridge implementation
- **bridge/hcode.js**: Message definitions, class mappings, encoders

**Q-Link Reloaded Server**:
- **qlink/src/main/java/org/jbrain/qlink/connection/QConnection.java**: Q-Link connection handler
- **qlink/src/main/java/org/jbrain/qlink/connection/HabitatConnection.java**: Habitat-specific Q-Link proxy
- **qlink/src/main/java/org/jbrain/qlink/util/CRC16.java**: CRC16 algorithm implementation
- **qlink/src/main/java/org/jbrain/qlink/cmd/Command.java**: Q-Link command interface
- **qlink/reference/protocol/**: Original Q-Link protocol reverse engineering notes

**Documentation**:
- **neohabitat-doc/docs/getting_started.md**: Setup and architecture overview
- **neohabitat-doc/docs/images/packet.jpg**: Visual packet diagram
- **qlink/reference/protocol/qlink protocol.txt**: Q-Link protocol analysis
- **qlink/reference/protocol/general.txt**: C64 assembly code analysis
- **qlink/reference/protocol/qlinkfuncs.txt**: Q-Link command reference

### External Documentation

- [Elko Server](https://github.com/FUDCo/Elko): Modern server framework
- [QuantumLink Reloaded](https://github.com/ssalevan/qlink): Q-Link protocol implementation
- [Original Habitat Manual (1988)](https://frandallfarmer.github.io/neohabitat-doc/docs/Avatar%20Handbook.html)
- [NeoHabitat Wiki](https://github.com/frandallfarmer/neohabitat/wiki/Developers-Documentation)
- [Q-Link Protocol Archive](https://github.com/ssalevan/qlink/tree/master/reference/protocol): Original protocol documentation and reverse engineering

### Community

- [Discord](https://discord.gg/rspcX27Vt4): Developer discussions
- [GitHub Issues](https://github.com/frandallfarmer/neohabitat/issues): Bug reports

---

## Version History

- **2025-12-29**: Comprehensive protocol documentation compiled from:
  - NeoHabitat bridge source code analysis
  - Q-Link Reloaded server implementation
  - Original Q-Link protocol reverse engineering notes
  - C64 assembly code disassembly
- Protocol implements 1986 Lucasfilm Habitat binary format
- Modern bridge created 2016-2017 for NeoHabitat project
- Q-Link Reloaded server by Jim Brain (2005+)

---

## Acknowledgments

This documentation is based on:

**Original Systems**:
- **Habitat Protocol** (1985): Chip Morningstar, Randy Farmer, and Lucasfilm Games
- **QuantumLink Service** (1985): Quantum Computer Services (later AOL)
- Original Habitat was the world's first graphical MMO, running on Commodore 64

**Modern Implementations**:
- **Habitat2ElkoBridge.js**: Randy Farmer, Steve Salevan, and NeoHabitat contributors
- **Q-Link Reloaded**: Jim Brain (reverse engineering and Java implementation)
- **Elko Server**: Electric Communities / Randy Farmer
- **NeoHabitat Project**: Community-driven restoration effort

**Protocol Research**:
- Q-Link protocol reverse engineering by Jim Brain and the Commodore community
- C64 assembly disassembly and documentation
- Original Q-Link client analysis

NeoHabitat faithfully recreates the 1985 Habitat protocol for modern systems while preserving the authentic 1200 baud experience of the original QuantumLink dialup service.
