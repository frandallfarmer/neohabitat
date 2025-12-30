#!/usr/bin/env node
/**
 * Habitat Session Analyzer
 *
 * Correlates Q-Link and Bridge logs to show complete user session activity.
 * Displays Q-Link framing layer, Habitat protocol, and Elko JSON messages
 * for a single user session in chronological order.
 */

const fs = require('fs');
const readline = require('readline');
const { execSync } = require('child_process');
const qlink = require('./qlink-decoder');
const habitat = require('./protocol-decoder');
const bridgeParser = require('./log-parser');

/**
 * Parse timestamp from Q-Link log line
 * Format: 2025-12-27 14:53:43,131
 */
function parseQLinkTimestamp(line) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3})/);
    if (!match) return null;

    const [, datetime, millis] = match;
    return new Date(datetime.replace(' ', 'T') + '.' + millis + 'Z');
}

/**
 * Parse timestamp from Bridge log line
 * Bridge logs may not have timestamps, so we'll use file stats or estimate
 */
function parseBridgeTimestamp(line) {
    // Bridge logs typically don't have timestamps in the format we saw
    // We'll need to estimate based on log order or use system time
    return null;
}

/**
 * Extract username from Q-Link log line
 */
function extractQLinkUsername(line) {
    // From login: "New Habilink login with username: ro"
    let match = line.match(/username:\s+(\w+)/i);
    if (match) return match[1].toLowerCase();

    // From packet: "Received Habitat Packet: 43 68..." where bytes are "username:"
    match = line.match(/Received Habitat Packet:\s+([0-9A-F\s]+)/i);
    if (match) {
        const bytes = match[1].trim().split(/\s+/).map(h => parseInt(h, 16));
        const colonIndex = bytes.indexOf(0x3A); // ':'
        if (colonIndex > 0) {
            const usernameBytes = bytes.slice(0, colonIndex);
            return String.fromCharCode(...usernameBytes).toLowerCase();
        }
    }

    // From session: "modeki" in various contexts
    match = line.match(/session.*?:\s*(\w+)/i);
    if (match) return match[1].toLowerCase();

    return null;
}

/**
 * Extract username from Bridge log line
 */
function extractBridgeUsername(line) {
    // From session identifier: "(2087:Chalcedony)"
    const match = line.match(/\((?:\d+:)?([^)]+)\)/);
    if (match) return match[1].toLowerCase();

    return null;
}

/**
 * Parse Q-Link log entry
 */
function parseQLinkEntry(line) {
    const timestamp = parseQLinkTimestamp(line);
    const username = extractQLinkUsername(line);

    const entry = {
        source: 'qlink',
        timestamp,
        username,
        raw: line,
        type: 'unknown'
    };

    // Determine entry type - check all Q-Link event types
    if (line.includes('Incoming connection')) {
        entry.type = 'connection';
        entry.event = 'connect';
    } else if (line.includes('Terminating link') || line.includes('Disconnect')) {
        entry.type = 'connection';
        entry.event = 'disconnect';
    } else if (line.includes('login with username') || line.includes('New Habilink login')) {
        entry.type = 'login';
    } else if (line.includes('Sending packet data')) {
        entry.type = 'packet-send';
        entry.packet = qlink.parseQLinkLogLine(line);
    } else if (line.includes('Received packet:')) {
        entry.type = 'packet-receive';
        entry.packet = qlink.parseQLinkLogLine(line);
    } else if (line.includes('Sending Habitat Packet')) {
        entry.type = 'habitat-send';
        entry.packet = qlink.parseQLinkLogLine(line);
    } else if (line.includes('Received Habitat Packet')) {
        entry.type = 'habitat-receive';
        entry.packet = qlink.parseQLinkLogLine(line);
    } else if (line.includes('Sending Queued Actions')) {
        entry.type = 'queue-send';
    } else if (line.includes('Freed sequence number')) {
        entry.type = 'ack';
        const seqMatch = line.match(/sequence number:\s*(\d+)/);
        if (seqMatch) entry.sequence = parseInt(seqMatch[1]);
    } else if (line.includes('Keep-alive') || line.includes('keepalive')) {
        entry.type = 'keepalive';
    } else if (line.includes('Received incoming packet with sequence')) {
        entry.type = 'packet-ack';
        const seqMatch = line.match(/sequence number:\s*(\d+)/);
        if (seqMatch) entry.sequence = parseInt(seqMatch[1]);
    } else if (line.includes('Setting QConnection username')) {
        entry.type = 'user-setup';
    } else if (line.includes('Adding session') || line.includes('Removing session')) {
        entry.type = 'session-mgmt';
        entry.event = line.includes('Adding') ? 'add' : 'remove';
    } else if (line.includes('Starting link thread')) {
        entry.type = 'thread-start';
    } else if (line.match(/ERROR|WARN/)) {
        entry.type = 'error';
        entry.level = line.includes('ERROR') ? 'ERROR' : 'WARN';
    }

    return entry;
}

/**
 * Parse Bridge log entry
 */
function parseBridgeEntry(line, lineNumber) {
    const username = extractBridgeUsername(line);

    const entry = {
        source: 'bridge',
        timestamp: null, // Bridge logs don't have timestamps
        lineNumber,
        username,
        raw: line,
        type: 'unknown'
    };

    const parsed = bridgeParser.parseLogLine(line);
    entry.parsed = parsed;
    entry.type = parsed.type;

    return entry;
}

/**
 * Read Q-Link logs from Docker container
 */
async function readQLinkLogs(hostname, tailLines = 10000) {
    console.error(`Fetching Q-Link logs from ${hostname}...`);
    try {
        const cmd = `ssh ${hostname} "sudo docker logs --tail ${tailLines} neohabitat-qlink-1 2>&1"`;
        const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
        return output.split('\n');
    } catch (err) {
        console.error('Error reading Q-Link logs:', err.message);
        return [];
    }
}

/**
 * Read Bridge logs
 */
async function readBridgeLogs(hostname, tailLines = 10000) {
    console.error(`Fetching Bridge logs from ${hostname}...`);
    try {
        const cmd = `ssh ${hostname} "tail -${tailLines} ~/neohabitat/bridge/bridge.log"`;
        const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
        return output.split('\n');
    } catch (err) {
        console.error('Error reading Bridge logs:', err.message);
        return [];
    }
}

/**
 * Find sessions matching criteria
 */
function findSessions(qlinkEntries, bridgeEntries, username, datetime) {
    const sessions = new Map();

    // Build sessions from Q-Link logs (which have timestamps)
    let currentSession = null;
    let sessionStartTime = null;

    qlinkEntries.forEach(entry => {
        if (entry.type === 'login' && entry.username) {
            // Start new session
            sessionStartTime = entry.timestamp || new Date();
            currentSession = {
                username: entry.username,
                startTime: sessionStartTime,
                endTime: null,
                qlinkEntries: [],
                bridgeEntries: []
            };
            sessions.set(entry.username + ':' + sessionStartTime.getTime(), currentSession);
        }

        // Add ALL Q-Link entries to current session (not just those with matching username)
        // This includes heartbeat, NAK, connection events, etc.
        if (currentSession) {
            // If entry has a username, check it matches; otherwise include it anyway
            if (!entry.username || entry.username === currentSession.username) {
                currentSession.qlinkEntries.push(entry);
            }

            if (entry.type === 'connection' && entry.event === 'disconnect') {
                currentSession.endTime = entry.timestamp;
                currentSession = null;
            }
        }
    });

    // Match bridge entries to sessions by username and time proximity
    bridgeEntries.forEach(entry => {
        if (!entry.username) return;

        // Find matching session by username
        for (const [key, session] of sessions) {
            if (session.username.toLowerCase() === entry.username.toLowerCase()) {
                session.bridgeEntries.push(entry);
                break;
            }
        }
    });

    // Match Bridge binary entries to Q-Link packets based on timing
    // RECV (client→server): Bridge processes just AFTER Q-Link receives
    // SEND (server→client): Bridge generates just BEFORE Q-Link sends
    sessions.forEach(session => {
        if (session.bridgeEntries.length === 0) return;

        // Get only binary Bridge entries (Habitat protocol messages, not JSON)
        const binaryBridgeEntries = session.bridgeEntries.filter(e =>
            e.type === 'client-to-server' ||
            e.type === 'server-to-client' ||
            e.type === 'binary-to-client'
        );

        // Get Q-Link entries with Habitat packets
        const qlinkHabitatEntries = session.qlinkEntries.filter(e =>
            (e.type === 'habitat-receive' || e.type === 'habitat-send') &&
            e.packet && e.packet.decoded && e.packet.decoded.habitatPacket
        );

        let bridgeIndex = 0;

        // Process Q-Link packets sequentially
        qlinkHabitatEntries.forEach(qlinkEntry => {
            if (bridgeIndex >= binaryBridgeEntries.length) return;

            const bridgeEntry = binaryBridgeEntries[bridgeIndex];
            const qlinkTime = qlinkEntry.timestamp;

            if (!qlinkTime) return;

            // RECV: Bridge handles just after Q-Link receives (client→server)
            // SEND: Bridge generates just before Q-Link sends (server→client)
            if (qlinkEntry.type === 'habitat-receive') {
                // Client message: Bridge processes after Q-Link receives
                bridgeEntry.matchedTimestamp = new Date(qlinkTime.getTime() + 1);
            } else if (qlinkEntry.type === 'habitat-send') {
                // Server message: Bridge generates before Q-Link sends
                bridgeEntry.matchedTimestamp = new Date(qlinkTime.getTime() - 1);
            }

            bridgeIndex++;
        });

        // For unmatched Bridge entries, estimate timestamps
        const unmatchedBridge = session.bridgeEntries.filter(e => !e.matchedTimestamp);

        if (unmatchedBridge.length > 0 && session.startTime) {
            const duration = session.endTime ?
                (session.endTime.getTime() - session.startTime.getTime()) :
                (5 * 60 * 1000);

            unmatchedBridge.forEach((entry, i) => {
                const offset = (duration / unmatchedBridge.length) * i;
                entry.estimatedTimestamp = new Date(session.startTime.getTime() + offset);
            });
        }
    });

    // Filter by criteria
    let filtered = Array.from(sessions.values());

    if (username) {
        filtered = filtered.filter(s => s.username.toLowerCase() === username.toLowerCase());
    }

    if (datetime === 'latest') {
        // Get the most recent session
        filtered.sort((a, b) => (b.startTime?.getTime() || 0) - (a.startTime?.getTime() || 0));
        filtered = filtered.slice(0, 1);
    } else if (datetime) {
        // Filter by date
        const targetDate = new Date(datetime);
        filtered = filtered.filter(s => {
            if (!s.startTime) return false;
            const sessionDate = new Date(s.startTime);
            return sessionDate.toDateString() === targetDate.toDateString();
        });
    }

    return filtered;
}

/**
 * Format session output
 */
function formatSession(session, verbose = false) {
    const output = [];

    output.push('═'.repeat(80));
    output.push(`SESSION: ${session.username}`);
    output.push(`Started: ${session.startTime?.toISOString() || 'unknown'}`);
    output.push(`Ended:   ${session.endTime?.toISOString() || 'ongoing'}`);
    output.push(`Q-Link entries: ${session.qlinkEntries.length}`);
    output.push(`Bridge entries: ${session.bridgeEntries.length}`);
    output.push('═'.repeat(80));
    output.push('');

    // Merge and sort all entries by timestamp (matched, estimated, or real)
    const allEntries = [
        ...session.qlinkEntries.map(e => ({
            ...e,
            sortTime: e.timestamp?.getTime() || 0,
            displayTimestamp: e.timestamp,
            isEstimated: false
        })),
        ...session.bridgeEntries.map(e => ({
            ...e,
            sortTime: (e.matchedTimestamp || e.estimatedTimestamp)?.getTime() || 0,
            displayTimestamp: e.matchedTimestamp || e.estimatedTimestamp,
            isEstimated: !e.matchedTimestamp
        }))
    ];

    allEntries.sort((a, b) => a.sortTime - b.sortTime);

    // Format each entry
    allEntries.forEach((entry, i) => {
        const time = entry.displayTimestamp ?
            entry.displayTimestamp.toISOString().substr(11, 12) :
            `~${i.toString().padStart(4, '0')}`;

        // Mark estimated timestamps (~ prefix for unmatched Bridge entries)
        const timePrefix = (entry.source === 'bridge' && entry.isEstimated) ? '~' : '';
        const prefix = `[${timePrefix}${time}] [${entry.source.toUpperCase()}]`;

        if (entry.source === 'qlink') {
            formatQLinkEntry(entry, prefix, output, verbose);
        } else {
            formatBridgeEntry(entry, prefix, output, verbose);
        }

        output.push('');
    });

    return output.join('\n');
}

/**
 * Decode operation-specific payload data
 */
function decodeOperationPayload(operation, payload) {
    if (!payload || payload.length === 0) return null;

    const decoded = {};

    switch (operation) {
        case 'SPEAK':
            // SPEAK: byte 0 is ESP flag, bytes 1+ are text
            if (payload.length > 1) {
                decoded.esp = payload[0];
                decoded.text = String.fromCharCode(...payload.slice(1));
            }
            break;

        case 'OBJECT_TALKS':
            // OBJECT_TALKS: byte 0 is speaker, bytes 1+ are text
            if (payload.length > 1) {
                decoded.speaker = payload[0];
                decoded.text = String.fromCharCode(...payload.slice(1));
            }
            break;

        case 'POSTURE':
            // POSTURE: single byte indicating pose
            if (payload.length >= 1) {
                decoded.posture = payload[0];
            }
            break;

        case 'WALK':
            // WALK: x, y coordinates and direction
            if (payload.length >= 3) {
                decoded.x = payload[0];
                decoded.y = payload[1];
                decoded.direction = payload[2];
            }
            break;

        // Add more operation decoders as needed
    }

    return Object.keys(decoded).length > 0 ? decoded : null;
}

/**
 * Format Q-Link entry
 */
function formatQLinkEntry(entry, prefix, output, verbose) {
    switch (entry.type) {
        case 'connection':
            output.push(`${prefix} ${entry.event.toUpperCase()}`);
            break;

        case 'login':
            output.push(`${prefix} LOGIN: ${entry.username}`);
            break;

        case 'packet-send':
        case 'packet-receive':
            const dir = entry.type === 'packet-send' ? '→ SEND' : '← RECV';

            if (entry.packet && entry.packet.decoded) {
                const decoded = entry.packet.decoded;
                const crcStatus = decoded.crcValid ? '✓' : '✗';
                const seq = entry.packet.sequence !== undefined ? ` seq=${entry.packet.sequence}` : '';

                // Show Q-Link packet info
                output.push(`${prefix} ${dir} Q-Link${seq} CRC=0x${decoded.crc?.value.toString(16).toUpperCase().padStart(4, '0')} ${crcStatus}`);

                // Show embedded Habitat packet if present
                if (decoded.habitatPacket) {
                    const hp = decoded.habitatPacket;
                    const op = hp.operation || 'UNKNOWN';
                    const noid = hp.noid;
                    const hseq = hp.control?.sequence || '?';
                    const flags = [];
                    if (hp.control?.splitStart) flags.push('START');
                    if (hp.control?.splitMid) flags.push('MID');
                    if (hp.control?.splitEnd) flags.push('END');
                    const split = flags.length > 0 ? ` [${flags.join('|')}]` : '';

                    output.push(`     └─ Habitat: ${op} NOID=${noid} seq=${hseq}${split}`);

                    if (hp.payloadLength > 0) {
                        // Try to decode operation-specific payload
                        const opDecoded = decodeOperationPayload(op, hp.payload);

                        if (opDecoded) {
                            // Show decoded information
                            if (opDecoded.text) {
                                // Show speaker for OBJECT_TALKS
                                if (opDecoded.speaker !== undefined) {
                                    output.push(`        Speaker=${opDecoded.speaker}: "${opDecoded.text}"`);
                                } else {
                                    output.push(`        "${opDecoded.text}"`);
                                }
                                if (verbose && opDecoded.esp !== undefined) {
                                    output.push(`        ESP: ${opDecoded.esp}`);
                                }
                            }
                            for (const [key, value] of Object.entries(opDecoded)) {
                                if (key !== 'text' && key !== 'esp' && key !== 'speaker') {
                                    output.push(`        ${key}: ${value}`);
                                }
                            }
                        } else if (verbose) {
                            // Show hex preview
                            const preview = hp.payload.slice(0, 8).map(b =>
                                ('0' + b.toString(16).toUpperCase()).slice(-2)
                            ).join(' ');
                            const more = hp.payloadLength > 8 ? ` ... (${hp.payloadLength} bytes)` : '';
                            output.push(`        Payload: ${preview}${more}`);
                        }
                    }
                } else {
                    // No Habitat packet, show raw payload
                    const preview = decoded.unescaped.slice(0, 16).map(b =>
                        ('0' + b.toString(16).toUpperCase()).slice(-2)
                    ).join(' ');
                    const more = decoded.payloadLength > 16 ? '...' : '';
                    output.push(`     └─ Raw: ${preview}${more}`);
                }

                if (verbose && decoded.warning) {
                    output.push(`     ⚠ ${decoded.warning}`);
                }
            } else {
                output.push(`${prefix} ${dir} (unparsed)`);
            }
            break;

        case 'habitat-send':
        case 'habitat-receive':
            const hdir = entry.type === 'habitat-send' ? '→ SEND' : '← RECV';

            if (entry.packet && entry.packet.decoded && entry.packet.decoded.habitatPacket) {
                const hp = entry.packet.decoded.habitatPacket;
                const op = hp.operation || 'UNKNOWN';
                const noid = hp.noid;
                const seq = hp.requestNum || '?';

                output.push(`${prefix} ${hdir} Habitat: ${op} NOID=${noid} req=${seq}`);

                if (entry.packet.username) {
                    output.push(`     └─ User: ${entry.packet.username}`);
                }

                if (hp.payloadLength > 0) {
                    // Try to decode operation-specific payload
                    const opDecoded = decodeOperationPayload(op, hp.payload);

                    if (opDecoded) {
                        // Show decoded information
                        if (opDecoded.text) {
                            // Show speaker for OBJECT_TALKS
                            if (opDecoded.speaker !== undefined) {
                                output.push(`        Speaker=${opDecoded.speaker}: "${opDecoded.text}"`);
                            } else {
                                output.push(`        "${opDecoded.text}"`);
                            }
                            if (verbose && opDecoded.esp !== undefined) {
                                output.push(`        ESP: ${opDecoded.esp}`);
                            }
                        }
                        for (const [key, value] of Object.entries(opDecoded)) {
                            if (key !== 'text' && key !== 'esp' && key !== 'speaker') {
                                output.push(`        ${key}: ${value}`);
                            }
                        }
                    } else if (verbose) {
                        // Show hex preview
                        const preview = hp.payload.slice(0, 16).map(b =>
                            ('0' + b.toString(16).toUpperCase()).slice(-2)
                        ).join(' ');
                        output.push(`        Payload: ${preview}...`);
                    }
                }
            } else {
                output.push(`${prefix} ${hdir} Habitat (unwrapped)`);
                if (entry.packet?.username) {
                    output.push(`     └─ User: ${entry.packet.username}`);
                }
            }
            break;

        case 'queue-send':
            output.push(`${prefix} Sending Queued Actions`);
            break;

        case 'ack':
            output.push(`${prefix} ACK seq=${entry.sequence}`);
            break;

        case 'packet-ack':
            output.push(`${prefix} Received ACK seq=${entry.sequence}`);
            break;

        case 'keepalive':
            output.push(`${prefix} Keep-alive`);
            break;

        case 'user-setup':
            output.push(`${prefix} User Setup${entry.username ? ': ' + entry.username : ''}`);
            break;

        case 'session-mgmt':
            const smEvent = entry.event === 'add' ? 'Session Added' : 'Session Removed';
            output.push(`${prefix} ${smEvent}${entry.username ? ': ' + entry.username : ''}`);
            break;

        case 'thread-start':
            output.push(`${prefix} Link Thread Started`);
            break;

        case 'error':
            output.push(`${prefix} ${entry.level}: ${entry.raw.substring(entry.raw.indexOf(entry.level) + entry.level.length + 1, 100)}`);
            break;

        default:
            if (verbose) {
                output.push(`${prefix} ${entry.raw.substring(0, 100)}`);
            }
    }
}

/**
 * Format Bridge entry
 */
function formatBridgeEntry(entry, prefix, output, verbose) {
    switch (entry.type) {
        case 'connection-event':
            output.push(`${prefix} ${entry.parsed.event.toUpperCase()}`);
            if (verbose) {
                output.push(`     └─ ${entry.parsed.details}`);
            }
            break;

        case 'user-registration':
            output.push(`${prefix} USER REGISTERED: ${entry.parsed.username}`);
            output.push(`     └─ Context: ${entry.parsed.context}`);
            output.push(`     └─ Ref: ${entry.parsed.userRef}`);
            break;

        case 'client-to-server':
            const op = entry.parsed.operation || 'UNKNOWN';
            output.push(`${prefix} → Client Request: ${op} NOID=${entry.parsed.noid} seq=${entry.parsed.sequence}`);
            if (entry.parsed.payload.length > 0) {
                // Try to decode operation-specific payload
                const opDecoded = decodeOperationPayload(op, entry.parsed.payload);

                if (opDecoded) {
                    if (opDecoded.text) {
                        // Show speaker for OBJECT_TALKS
                        if (opDecoded.speaker !== undefined) {
                            output.push(`     └─ Speaker=${opDecoded.speaker}: "${opDecoded.text}"`);
                        } else {
                            output.push(`     └─ "${opDecoded.text}"`);
                        }
                        if (verbose && opDecoded.esp !== undefined) {
                            output.push(`        ESP: ${opDecoded.esp}`);
                        }
                    }
                    for (const [key, value] of Object.entries(opDecoded)) {
                        if (key !== 'text' && key !== 'esp' && key !== 'speaker') {
                            output.push(`     └─ ${key}: ${value}`);
                        }
                    }
                } else if (verbose) {
                    const preview = entry.parsed.payload.slice(0, 8).map(b =>
                        ('0' + b.toString(16).toUpperCase()).slice(-2)
                    ).join(' ');
                    const more = entry.parsed.payload.length > 8 ? ` ... (${entry.parsed.payload.length} bytes)` : '';
                    output.push(`     └─ Payload: ${preview}${more}`);
                }
            }
            break;

        case 'binary-to-client':
            const bop = entry.parsed.decoded?.operation || 'UNKNOWN';
            const bnoid = entry.parsed.decoded?.noid;
            const bseq = entry.parsed.decoded?.control?.sequence;
            output.push(`${prefix} ← Binary Response: ${bop} NOID=${bnoid}${bseq ? ` seq=${bseq}` : ''}`);
            if (entry.parsed.decoded?.payloadLength > 0) {
                // Try to decode operation-specific payload
                const opDecoded = decodeOperationPayload(bop, entry.parsed.decoded.payload);

                if (opDecoded) {
                    if (opDecoded.text) {
                        // Show speaker for OBJECT_TALKS
                        if (opDecoded.speaker !== undefined) {
                            output.push(`     └─ Speaker=${opDecoded.speaker}: "${opDecoded.text}"`);
                        } else {
                            output.push(`     └─ "${opDecoded.text}"`);
                        }
                        if (verbose && opDecoded.esp !== undefined) {
                            output.push(`        ESP: ${opDecoded.esp}`);
                        }
                    }
                    for (const [key, value] of Object.entries(opDecoded)) {
                        if (key !== 'text' && key !== 'esp' && key !== 'speaker') {
                            output.push(`     └─ ${key}: ${value}`);
                        }
                    }
                } else if (verbose) {
                    const preview = entry.parsed.decoded.payload.slice(0, 8).map(b =>
                        ('0' + b.toString(16).toUpperCase()).slice(-2)
                    ).join(' ');
                    const more = entry.parsed.decoded.payloadLength > 8 ? ` ... (${entry.parsed.decoded.payloadLength} bytes)` : '';
                    output.push(`     └─ Payload: ${preview}${more}`);
                }
            }
            break;

        case 'server-to-client':
        case 'json-to-server':
            const jdir = entry.type === 'server-to-client' ? '← Server' : '→ Client';
            const jop = entry.parsed.json?.op || 'UNKNOWN';
            output.push(`${prefix} ${jdir} JSON: ${jop}`);

            // Decode SPEAK$ and OBJECTSPEAK_$ messages
            if (jop === 'SPEAK$' && entry.parsed.json?.text) {
                const noid = entry.parsed.json.noid || '?';
                output.push(`     └─ NOID=${noid}: "${entry.parsed.json.text}"`);
            } else if (jop === 'OBJECTSPEAK_$' && entry.parsed.json?.text) {
                const speaker = entry.parsed.json.speaker || '?';
                output.push(`     └─ Speaker=${speaker}: "${entry.parsed.json.text}"`);
            } else if (entry.parsed.json?.to) {
                output.push(`     └─ To: ${entry.parsed.json.to}`);
            }

            if (verbose && entry.parsed.json?.obj) {
                const objType = entry.parsed.json.obj.type || 'unknown';
                const objRef = entry.parsed.json.obj.ref || '';
                output.push(`     └─ Object: ${objType} ${objRef}`);
                if (entry.parsed.json.obj.mods && entry.parsed.json.obj.mods[0]) {
                    const mod = entry.parsed.json.obj.mods[0];
                    output.push(`        Type: ${mod.type} NOID=${mod.noid || '?'}`);
                }
            }
            break;

        case 'json-to-server':
            output.push(`${prefix} → JSON to Server: ${entry.parsed.json?.op || 'UNKNOWN'}`);
            if (verbose && entry.parsed.json) {
                output.push(`     └─ ${JSON.stringify(entry.parsed.json).substring(0, 80)}...`);
            }
            break;

        default:
            if (verbose) {
                output.push(`${prefix} ${entry.type}: ${entry.raw.substring(0, 80)}`);
            }
    }
}

/**
 * Main CLI
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log('Habitat Session Analyzer');
        console.log('');
        console.log('Usage: session-analyzer.js [username] [datetime] [options]');
        console.log('');
        console.log('Arguments:');
        console.log('  username    Filter by username (optional)');
        console.log('  datetime    Filter by date or "latest" for most recent session (optional)');
        console.log('');
        console.log('Options:');
        console.log('  --host HOST     SSH hostname for logs (default: neohabitat)');
        console.log('  --qlink FILE    Use local Q-Link log file instead of SSH');
        console.log('  --bridge FILE   Use local Bridge log file instead of SSH');
        console.log('  --tail N        Number of log lines to fetch (default: 10000)');
        console.log('  --verbose       Show detailed packet information');
        console.log('  --help          Show this help');
        console.log('');
        console.log('Examples:');
        console.log('  session-analyzer.js                    # All recent sessions');
        console.log('  session-analyzer.js chalcedony latest  # Latest session for chalcedony');
        console.log('  session-analyzer.js modeki             # All sessions for modeki');
        console.log('  session-analyzer.js "" latest          # Latest session for any user');
        console.log('  session-analyzer.js --qlink qlink.log --bridge bridge.log  # Use local files');
        process.exit(0);
    }

    // Parse arguments
    const username = args[0] && !args[0].startsWith('--') ? args[0] : null;
    const datetime = args[1] && !args[1].startsWith('--') ? args[1] : null;

    const host = args.includes('--host') ? args[args.indexOf('--host') + 1] : 'neohabitat';
    const qlinkFile = args.includes('--qlink') ? args[args.indexOf('--qlink') + 1] : null;
    const bridgeFile = args.includes('--bridge') ? args[args.indexOf('--bridge') + 1] : null;
    const tailLines = args.includes('--tail') ? parseInt(args[args.indexOf('--tail') + 1]) : 10000;
    const verbose = args.includes('--verbose');

    console.error('Habitat Session Analyzer');
    console.error('');

    // Read logs
    let qlinkLines, bridgeLines;

    if (qlinkFile) {
        console.error(`Reading Q-Link log: ${qlinkFile}`);
        qlinkLines = fs.readFileSync(qlinkFile, 'utf8').split('\n');
    } else {
        qlinkLines = await readQLinkLogs(host, tailLines);
    }

    if (bridgeFile) {
        console.error(`Reading Bridge log: ${bridgeFile}`);
        bridgeLines = fs.readFileSync(bridgeFile, 'utf8').split('\n');
    } else {
        bridgeLines = await readBridgeLogs(host, tailLines);
    }

    console.error(`Q-Link: ${qlinkLines.length} lines`);
    console.error(`Bridge: ${bridgeLines.length} lines`);
    console.error('');

    // Parse entries
    const qlinkEntries = qlinkLines
        .filter(line => line.trim())
        .map(line => parseQLinkEntry(line))
        .filter(e => e.type !== 'unknown' || e.username);

    const bridgeEntries = bridgeLines
        .filter(line => line.trim())
        .map((line, i) => parseBridgeEntry(line, i))
        .filter(e => e.username);

    console.error(`Parsed ${qlinkEntries.length} Q-Link entries`);
    console.error(`Parsed ${bridgeEntries.length} Bridge entries`);
    console.error('');

    // Find sessions
    const sessions = findSessions(qlinkEntries, bridgeEntries, username, datetime);

    console.error(`Found ${sessions.length} matching sessions`);
    console.error('');
    console.error('═'.repeat(80));
    console.error('');

    // Output sessions
    if (sessions.length === 0) {
        console.log('No sessions found matching criteria.');
    } else {
        sessions.forEach(session => {
            console.log(formatSession(session, verbose));
            console.log('');
        });
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Error:', err.message);
        if (process.env.DEBUG) {
            console.error(err.stack);
        }
        process.exit(1);
    });
}

module.exports = {
    parseQLinkEntry,
    parseBridgeEntry,
    findSessions,
    formatSession
};
