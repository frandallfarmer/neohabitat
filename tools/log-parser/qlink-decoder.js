#!/usr/bin/env node
/**
 * Q-Link Protocol Decoder
 *
 * Decodes Q-Link framing layer packets including CRC16 validation and escape sequences.
 * See PROTOCOL.md for complete Q-Link protocol documentation.
 */

const habitatDecoder = require('./protocol-decoder');

const QLINK = {
    PACKET_START: 0x5A,  // 'Z'
    FRAME_END: 0x0D,     // '\r'
    ESCAPE_CHAR: 0x5D,
    ESCAPE_XOR: 0x55,
    CRC_POLY: 0xA001
};

/**
 * Calculate CRC16 for Q-Link protocol
 * @param {Array<number>} data - Byte array
 * @returns {number} 16-bit CRC value
 */
function calculateCRC16(data) {
    let crc = 0;

    for (let byte of data) {
        for (let bit = 0; bit < 8; bit++) {
            crc = crc ^ (byte & 1);
            byte = byte >> 1;

            if ((crc & 1) !== 0) {
                crc = crc >> 1;
                crc = crc ^ QLINK.CRC_POLY;
            } else {
                crc = crc >> 1;
            }
        }
    }

    return crc & 0xFFFF;
}

/**
 * Encode CRC16 into 4 bytes for Q-Link packet format
 * @param {number} crc - 16-bit CRC value
 * @returns {Array<number>} 4-byte encoded CRC
 */
function encodeCRC(crc) {
    const A = (crc & 0x00F0) | 0x01;
    const B = (crc & 0x000F) | 0x40;
    const C = (crc & 0xF000) >> 8 | 0x01;
    const D = (crc & 0x0F00) >> 8 | 0x40;
    return [A, B, C, D];
}

/**
 * Decode 4-byte CRC from Q-Link packet format
 * @param {Array<number>} encoded - 4-byte encoded CRC
 * @returns {number} 16-bit CRC value
 */
function decodeCRC(encoded) {
    if (encoded.length < 4) return null;

    const A = encoded[0];
    const B = encoded[1];
    const C = encoded[2];
    const D = encoded[3];

    // Extract nibbles from encoded bytes
    const lowByte = (A & 0xF0) | (B & 0x0F);
    const highByte = (C & 0xF0) | (D & 0x0F);

    // Combine into 16-bit value (big-endian: high byte first in value)
    return ((lowByte << 8) | highByte) & 0xFFFF;
}

/**
 * Remove Q-Link escape sequences
 * @param {Array<number>} data - Escaped byte array
 * @returns {Array<number>} Unescaped byte array
 */
function unescape(data) {
    const result = [];
    let i = 0;

    while (i < data.length) {
        if (data[i] === QLINK.ESCAPE_CHAR && i + 1 < data.length) {
            result.push(data[i + 1] ^ QLINK.ESCAPE_XOR);
            i += 2;
        } else {
            result.push(data[i]);
            i++;
        }
    }

    return result;
}

/**
 * Add Q-Link escape sequences
 * @param {Array<number>} data - Unescaped byte array
 * @returns {Array<number>} Escaped byte array
 */
function escape(data) {
    const result = [];

    for (let byte of data) {
        if (byte === QLINK.FRAME_END || byte === QLINK.ESCAPE_CHAR) {
            result.push(QLINK.ESCAPE_CHAR);
            result.push(byte ^ QLINK.ESCAPE_XOR);
        } else {
            result.push(byte);
        }
    }

    return result;
}

/**
 * Decode a Q-Link protocol packet
 * @param {Array<number>} bytes - Raw packet bytes
 * @returns {Object} Decoded Q-Link packet with embedded Habitat packet
 */
function decodeQLinkPacket(bytes) {
    const result = {
        raw: bytes,
        rawHex: bytes.map(b => ('0' + b.toString(16).toUpperCase()).slice(-2)).join(' '),
        valid: false,
        layer: 'qlink'
    };

    if (bytes.length < 6) {
        result.error = 'Packet too short for Q-Link (< 6 bytes)';
        return result;
    }

    // Check for Q-Link start marker
    if (bytes[0] !== QLINK.PACKET_START) {
        result.error = `Invalid Q-Link start marker: expected 0x5A, got 0x${bytes[0].toString(16)}`;
        return result;
    }

    // Extract CRC (4 bytes after start marker)
    const encodedCRC = bytes.slice(1, 5);
    result.crc = {
        encoded: encodedCRC,
        encodedHex: encodedCRC.map(b => ('0' + b.toString(16).toUpperCase()).slice(-2)).join(' '),
        value: decodeCRC(encodedCRC)
    };

    // Find frame end (if present)
    let endIndex = bytes.indexOf(QLINK.FRAME_END, 5);
    const hasFrameEnd = endIndex !== -1;

    if (!hasFrameEnd) {
        endIndex = bytes.length; // No frame end, use entire packet
        result.warning = 'No frame end (0x0D) found - packet may be truncated';
    }

    // Extract payload (between CRC and frame end)
    const payload = bytes.slice(5, endIndex);
    result.payload = payload;
    result.payloadHex = payload.map(b => ('0' + b.toString(16).toUpperCase()).slice(-2)).join(' ');
    result.payloadLength = payload.length;
    result.hasFrameEnd = hasFrameEnd;

    // Unescape payload
    const unescaped = unescape(payload);
    result.unescaped = unescaped;
    result.unescapedHex = unescaped.map(b => ('0' + b.toString(16).toUpperCase()).slice(-2)).join(' ');

    // Calculate expected CRC
    result.calculatedCRC = calculateCRC16(unescaped);
    result.crcValid = (result.crc.value === result.calculatedCRC);

    if (!result.crcValid) {
        result.warning = (result.warning ? result.warning + '; ' : '') +
            `CRC mismatch: expected 0x${result.calculatedCRC.toString(16).toUpperCase()}, ` +
            `got 0x${result.crc.value.toString(16).toUpperCase()}`;
    }

    // Try to decode embedded Habitat packet
    // Check if packet starts with Habitat marker (0x55)
    if (unescaped.length > 0 && unescaped[0] === habitatDecoder.HCode.MICROCOSM_ID_BYTE) {
        result.habitatPacket = habitatDecoder.decodePacket(unescaped);
    } else {
        // For SEND packets, there may be a 3-byte Q-Link header before Habitat packet
        // Try to find the Habitat marker (0x55) in the payload
        const habitatStartIndex = unescaped.indexOf(habitatDecoder.HCode.MICROCOSM_ID_BYTE);
        if (habitatStartIndex > 0 && habitatStartIndex < 4) {
            const habitatBytes = unescaped.slice(habitatStartIndex);
            result.habitatPacket = habitatDecoder.decodePacket(habitatBytes);
            result.qlinkHeader = unescaped.slice(0, habitatStartIndex);
        }
    }

    result.valid = true;
    result.length = bytes.length;

    return result;
}

/**
 * Format a Q-Link packet for display
 * @param {Object} decoded - Result from decodeQLinkPacket()
 * @param {boolean} verbose - Include detailed breakdown
 * @returns {string} Formatted output
 */
function formatQLinkPacket(decoded, verbose = false) {
    if (!decoded.valid && decoded.error) {
        return `ERROR: ${decoded.error}\n  Raw: ${decoded.rawHex}`;
    }

    const output = [];

    // Header
    output.push('═══ Q-LINK PACKET ═══');

    if (verbose) {
        output.push(`Raw (${decoded.length} bytes): ${decoded.rawHex}`);
        output.push('');
    }

    // CRC info
    const crcStatus = decoded.crcValid ? '✓ VALID' : '✗ INVALID';
    output.push(`CRC16: 0x${decoded.crc.value.toString(16).toUpperCase().padStart(4, '0')} ${crcStatus}`);
    if (!decoded.crcValid) {
        output.push(`  Expected: 0x${decoded.calculatedCRC.toString(16).toUpperCase().padStart(4, '0')}`);
        output.push(`  Encoded:  ${decoded.crc.encodedHex}`);
    }

    // Payload
    output.push(`Payload: ${decoded.payloadLength} bytes${decoded.hasFrameEnd ? '' : ' (no frame end)'}`);
    if (verbose) {
        output.push(`  Escaped:   ${decoded.payloadHex}`);
        output.push(`  Unescaped: ${decoded.unescapedHex}`);
    }

    // Embedded Habitat packet
    if (decoded.habitatPacket) {
        output.push('');
        output.push('═══ HABITAT PACKET ═══');
        output.push(habitatDecoder.formatPacket(decoded.habitatPacket, verbose));
    }

    if (decoded.warning) {
        output.push('');
        output.push(`Warning: ${decoded.warning}`);
    }

    return output.join('\n');
}

/**
 * Parse Q-Link packet from log line
 * @param {string} line - Log line from qlink container
 * @returns {Object|null} Parsed packet info or null
 */
function parseQLinkLogLine(line) {
    // Pattern: "Sending packet data at sequence XX: 5A ..."
    const sendMatch = line.match(/Sending packet data at sequence (\d+):\s+([0-9A-F\s]+)/i);
    if (sendMatch) {
        const [, seq, hexStr] = sendMatch;
        const bytes = hexStr.trim().split(/\s+/).map(h => parseInt(h, 16));
        return {
            direction: 'send',
            sequence: parseInt(seq, 10),
            bytes,
            decoded: decodeQLinkPacket(bytes)
        };
    }

    // Pattern: "Received packet: 5A ..."
    const recvMatch = line.match(/Received packet:\s+([0-9A-F\s]+)/i);
    if (recvMatch) {
        const hexStr = recvMatch[1];
        const bytes = hexStr.trim().split(/\s+/).map(h => parseInt(h, 16));
        return {
            direction: 'receive',
            bytes,
            decoded: decodeQLinkPacket(bytes)
        };
    }

    // Pattern: "Sending Habitat Packet: 5A ..."
    const habitatSendMatch = line.match(/Sending Habitat Packet:\s+([0-9A-F\s]+)/i);
    if (habitatSendMatch) {
        const hexStr = habitatSendMatch[1];
        const bytes = hexStr.trim().split(/\s+/).map(h => parseInt(h, 16));
        return {
            direction: 'send',
            type: 'habitat-only',
            bytes,
            decoded: bytes[0] === QLINK.PACKET_START ?
                decodeQLinkPacket(bytes) :
                { habitatPacket: habitatDecoder.decodePacket(bytes) }
        };
    }

    // Pattern: "Received Habitat Packet: 43 68 61..." where bytes encode "username:PACKET"
    const habitatRecvMatch = line.match(/Received Habitat Packet:\s+([0-9A-F\s]+)/i);
    if (habitatRecvMatch) {
        const hexStr = habitatRecvMatch[1];
        const bytes = hexStr.trim().split(/\s+/).map(h => parseInt(h, 16));

        // Extract username from bytes (format: "username:PACKET")
        const colonIndex = bytes.indexOf(0x3A); // ':'
        let username = null;
        let packetBytes = bytes;

        if (colonIndex > 0 && colonIndex < 20) { // Username shouldn't be too long
            const usernameBytes = bytes.slice(0, colonIndex);
            username = String.fromCharCode(...usernameBytes);
            packetBytes = bytes.slice(colonIndex + 1); // Skip the ':'
        }

        return {
            direction: 'receive',
            type: 'habitat-only',
            username,
            bytes: packetBytes,
            decoded: packetBytes[0] === QLINK.PACKET_START ?
                decodeQLinkPacket(packetBytes) :
                { habitatPacket: habitatDecoder.decodePacket(packetBytes) }
        };
    }

    return null;
}

module.exports = {
    QLINK,
    calculateCRC16,
    encodeCRC,
    decodeCRC,
    escape,
    unescape,
    decodeQLinkPacket,
    formatQLinkPacket,
    parseQLinkLogLine
};

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: qlink-decoder.js <packet-hex>');
        console.log('');
        console.log('Examples:');
        console.log('  qlink-decoder.js "5A 01 4F C1 41 17 16 20 55 FA 00 11 01 0D"');
        console.log('  qlink-decoder.js "5A D1 49 81 45 16 16 20 55 E2 00 05"');
        console.log('');
        console.log('Or pipe from log:');
        console.log('  grep "Sending packet" qlink.log | qlink-decoder.js');
        process.exit(1);
    }

    // Read from stdin if available
    if (!process.stdin.isTTY) {
        let input = '';
        process.stdin.on('data', chunk => input += chunk);
        process.stdin.on('end', () => {
            const lines = input.split('\n').filter(l => l.trim());
            lines.forEach(line => {
                const parsed = parseQLinkLogLine(line);
                if (parsed) {
                    console.log(`\n${'='.repeat(60)}`);
                    console.log(`Direction: ${parsed.direction.toUpperCase()}${parsed.sequence ? ` (seq ${parsed.sequence})` : ''}`);
                    if (parsed.username) console.log(`Username: ${parsed.username}`);
                    console.log(formatQLinkPacket(parsed.decoded, true));
                }
            });
        });
    } else {
        // Parse from command line arg
        const hexString = args.join(' ');
        const bytes = hexString.trim().split(/\s+/).map(h => parseInt(h, 16));
        const decoded = decodeQLinkPacket(bytes);
        console.log(formatQLinkPacket(decoded, true));
    }
}
