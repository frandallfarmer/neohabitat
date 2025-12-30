#!/usr/bin/env node
/**
 * Habitat Protocol Decoder
 *
 * Decodes binary Habitat protocol packets based on the protocol specification.
 * See PROTOCOL.md for full protocol documentation.
 */

const HCode = {
    // Protocol constants from hcode.js
    MICROCOSM_ID_BYTE: 0x55,
    ESCAPE_CHAR: 0x5D,
    END_OF_MESSAGE: 0x0D,
    ESCAPE_XOR: 0x55,
    PHANTOM_REQUEST: 0xFA,
    MAX_PACKET_SIZE: 100,
    REGION_NOID: 0,
    BYTE_MASK: 0xFF,

    // Sequence flags
    SPLIT_START: 0x20,
    SPLIT_END: 0x80,
    SPLIT_MID: 0x40
};

// Message type names for region-level operations (NOID = 0)
// Based on MESSAGE_* constants from bridge/hcode.js
const REGION_OPS = {
    1: 'DESCRIBE',           // MESSAGE_DESCRIBE (ENSEMBLE packet)
    2: 'I_QUIT',             // MESSAGE_I_QUIT
    3: 'IM_ALIVE',           // MESSAGE_IM_ALIVE
    4: 'CUSTOMIZE',          // MESSAGE_CUSTOMIZE
    5: 'FINGER_IN_QUE',      // MESSAGE_FINGER_IN_QUE (while catchup)
    6: 'HERE_I_AM',          // MESSAGE_HERE_I_AM (materialize!)
    7: 'PROMPT_REPLY',       // MESSAGE_PROMPT_REPLY
    8: 'HEREIS',             // MESSAGE_HEREIS
    9: 'GOAWAY',             // MESSAGE_GOAWAY (object has left)
    10: 'PORT',              // MESSAGE_PORT (we have moved!)
    11: 'UPDATE_DISK',       // MESSAGE_UPDATE_DISK
    12: 'FIDDLE',            // MESSAGE_FIDDLE (fiddle with object)
    13: 'LIGHTING',          // MESSAGE_LIGHTING (change light level)
    14: 'MUSIC',             // MESSAGE_MUSIC (play a tune)
    15: 'OBJECT_TALKS',      // MESSAGE_OBJECT_TALKS (an object speaks!)
    16: 'WAIT_FOR_ANI',      // MESSAGE_WAIT_FOR_ANI (wait for an object)
    17: 'CAUGHT_UP',         // MESSAGE_CAUGHT_UP
    18: 'APPEAR',            // MESSAGE_APPEAR
    19: 'CHANGE_CONT',       // MESSAGE_CHANGE_CONT
    20: 'PROMPT_USER',       // MESSAGE_PROMPT_USER
    21: 'BEEN_MOVED',        // MESSAGE_BEEN_MOVED
    22: 'HOST_DUMP'          // MESSAGE_HOST_DUMP
};

// Common object-level operations (NOID > 0)
const OBJECT_OPS = {
    0: 'TOUCH',
    1: 'CHANGE_CONTAINERS',
    2: 'THROW',
    3: 'PUT',
    4: 'READ',
    5: 'CLOSE',
    6: 'POSTURE',
    7: 'SPEAK',
    8: 'WALK',
    9: 'WEAR',
    10: 'GET',
    11: 'ASK',
    12: 'GO',
    13: 'OFF',
    14: 'ON',
    15: 'ATTACK',
    16: 'BASH_OPEN',
    17: 'CLOSECONTAINER',
    18: 'FILL',
    19: 'HELP',
    20: 'MUNCH',
    21: 'PAY',
    22: 'PLAY',
    23: 'REMOVE_READIBLE',
    24: 'FAKERY'
};

/**
 * Decode a Habitat protocol packet
 * @param {Array<number>} bytes - Array of bytes (0-255)
 * @returns {Object} Decoded packet structure
 */
function decodePacket(bytes) {
    if (!Array.isArray(bytes) || bytes.length === 0) {
        return { error: 'Invalid packet: empty or not an array' };
    }

    const result = {
        raw: bytes,
        rawHex: bytes.map(b => ('0' + b.toString(16).toUpperCase()).slice(-2)).join(' '),
        valid: false
    };

    // Check for Microcosm ID byte
    if (bytes[0] !== HCode.MICROCOSM_ID_BYTE) {
        result.error = `Invalid packet: expected 0x55, got 0x${bytes[0].toString(16)}`;
        return result;
    }

    if (bytes.length < 3) {
        result.error = 'Invalid packet: too short (< 3 bytes)';
        return result;
    }

    // Parse header
    const control = bytes[1];
    const noid = bytes[2];

    result.control = {
        raw: control,
        hex: '0x' + ('0' + control.toString(16).toUpperCase()).slice(-2),
        splitEnd: !!(control & HCode.SPLIT_END),
        splitMid: !!(control & HCode.SPLIT_MID),
        splitStart: !!(control & HCode.SPLIT_START),
        sequence: control & 0x0F
    };

    result.noid = noid;
    result.isRegionMessage = (noid === HCode.REGION_NOID);

    // Parse request number if present
    if (bytes.length >= 4) {
        result.requestNum = bytes[3];

        // Determine message type
        if (result.isRegionMessage) {
            result.operation = REGION_OPS[result.requestNum] || `UNKNOWN_REGION_${result.requestNum}`;
        } else {
            result.operation = OBJECT_OPS[result.requestNum] || `UNKNOWN_OBJECT_${result.requestNum}`;
        }

        // Extract payload (after header)
        if (bytes.length > 4) {
            result.payload = bytes.slice(4);
            result.payloadHex = result.payload.map(b =>
                ('0' + b.toString(16).toUpperCase()).slice(-2)
            ).join(' ');
            result.payloadLength = result.payload.length;
        } else {
            result.payload = [];
            result.payloadLength = 0;
        }
    } else {
        result.error = 'Packet too short: missing request number';
    }

    result.valid = !result.error;
    result.length = bytes.length;

    return result;
}

/**
 * Format a decoded packet for display
 * @param {Object} decoded - Result from decodePacket()
 * @param {boolean} verbose - Include detailed breakdown
 * @returns {string} Formatted output
 */
function formatPacket(decoded, verbose = false) {
    if (!decoded.valid) {
        return `ERROR: ${decoded.error}\n  Raw: [${decoded.raw.join(', ')}]`;
    }

    let output = [];

    // Header line
    const header = `[${decoded.control.sequence}] NOID ${decoded.noid} ${decoded.operation || 'UNKNOWN'}`;
    output.push(header);

    if (verbose) {
        output.push(`  Raw: [${decoded.raw.join(', ')}]`);
        output.push(`  Hex: ${decoded.rawHex}`);
        output.push(`  Control: ${decoded.control.hex} (seq=${decoded.control.sequence}, ` +
                   `split=${decoded.control.splitStart ? 'S' : ''}${decoded.control.splitMid ? 'M' : ''}${decoded.control.splitEnd ? 'E' : ''})`);
        output.push(`  NOID: ${decoded.noid} ${decoded.isRegionMessage ? '(Region)' : '(Object)'}`);
        output.push(`  Request: ${decoded.requestNum}`);

        if (decoded.payloadLength > 0) {
            output.push(`  Payload (${decoded.payloadLength} bytes): [${decoded.payload.join(', ')}]`);
            output.push(`  Payload hex: ${decoded.payloadHex}`);
        }
    } else {
        if (decoded.payloadLength > 0) {
            const payloadPreview = decoded.payload.slice(0, 8).join(', ');
            const more = decoded.payloadLength > 8 ? ` ... +${decoded.payloadLength - 8} more` : '';
            output.push(`  Payload: [${payloadPreview}${more}]`);
        }
    }

    return output.join('\n');
}

/**
 * Parse a packet array from log format like "[85,236,0,1,0,0,32,0,11,...]"
 * @param {string} logLine - Line from bridge log
 * @returns {Array<number>|null} Byte array or null if not found
 */
function extractPacketFromLog(logLine) {
    const match = logLine.match(/\[(\d+(?:,\d+)*)\]/);
    if (!match) return null;

    return match[1].split(',').map(s => parseInt(s.trim(), 10));
}

module.exports = {
    HCode,
    REGION_OPS,
    OBJECT_OPS,
    decodePacket,
    formatPacket,
    extractPacketFromLog
};

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: protocol-decoder.js <packet-bytes>');
        console.log('');
        console.log('Examples:');
        console.log('  protocol-decoder.js "85,236,0,1,0,0,32,0,11"');
        console.log('  protocol-decoder.js "85,250,0,18,11"');
        console.log('');
        console.log('Or pipe from log:');
        console.log('  grep "\\[85," bridge.log | protocol-decoder.js');
        process.exit(1);
    }

    // Read from stdin if available
    if (!process.stdin.isTTY) {
        let input = '';
        process.stdin.on('data', chunk => input += chunk);
        process.stdin.on('end', () => {
            const lines = input.split('\n').filter(l => l.trim());
            lines.forEach(line => {
                const packet = extractPacketFromLog(line);
                if (packet) {
                    const decoded = decodePacket(packet);
                    console.log(formatPacket(decoded, true));
                    console.log('');
                }
            });
        });
    } else {
        // Parse from command line arg
        const byteString = args.join(' ').replace(/[\[\]]/g, '');
        const bytes = byteString.split(',').map(s => parseInt(s.trim(), 10));
        const decoded = decodePacket(bytes);
        console.log(formatPacket(decoded, true));
    }
}
