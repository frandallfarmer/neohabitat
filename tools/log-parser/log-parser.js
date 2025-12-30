#!/usr/bin/env node
/**
 * Habitat Bridge Log Parser
 *
 * Parses bridge.log files to extract and analyze Habitat protocol messages.
 */

const fs = require('fs');
const readline = require('readline');
const decoder = require('./protocol-decoder');

/**
 * Parse a bridge log line into structured data
 * @param {string} line - Raw log line
 * @returns {Object|null} Parsed log entry or null if not parseable
 */
function parseLogLine(line) {
    // Extract timestamp if present
    const timestampMatch = line.match(/^(\d{4}[-\/]\d{2}[-\/]\d{2}\s+\d{2}:\d{2}:\d{2}[.,]\d+)/);
    const timestamp = timestampMatch ? timestampMatch[1] : null;

    // Remove log level prefix (debug:, info:, etc.)
    const cleanLine = line.replace(/^(?:debug|info|warn|error):\s*/, '');

    // Pattern: "server (session) -> JSON"
    const serverToClientMatch = cleanLine.match(/^server\s*\(([^)]+)\)\s*->\s*(\{.+\})$/);
    if (serverToClientMatch) {
        const [, session, jsonStr] = serverToClientMatch;
        try {
            return {
                type: 'server-to-client',
                direction: 'server->client',
                session: session.trim(),
                timestamp,
                json: JSON.parse(jsonStr),
                rawJson: jsonStr,
                line
            };
        } catch (e) {
            return {
                type: 'server-to-client',
                direction: 'server->client',
                session: session.trim(),
                timestamp,
                parseError: e.message,
                rawJson: jsonStr,
                line
            };
        }
    }

    // Pattern: "client (session) -> [noid:X request:Y seq:Z ... [payload]]"
    const clientToServerMatch = cleanLine.match(/^client\s*\(([^)]+)\)\s*->\s*\[noid:(\d+)\s+request:(\d+)\s+seq:(\d+)\s*\.\.\.\s*\[([^\]]*)\]\]$/);
    if (clientToServerMatch) {
        const [, session, noid, request, seq, payloadStr] = clientToServerMatch;
        const payload = payloadStr.trim() ?
            payloadStr.split(',').map(s => parseInt(s.trim(), 10)) : [];

        return {
            type: 'client-to-server',
            direction: 'client->server',
            session: session.trim(),
            timestamp,
            noid: parseInt(noid, 10),
            request: parseInt(request, 10),
            sequence: parseInt(seq, 10),
            payload,
            operation: (parseInt(noid, 10) === 0) ?
                decoder.REGION_OPS[parseInt(request, 10)] :
                decoder.OBJECT_OPS[parseInt(request, 10)],
            line
        };
    }

    // Pattern: "[85,X,Y,Z,...] -> client (session)"
    const binaryToClientMatch = cleanLine.match(/^\[(\d+(?:,\d+)*)\]\s*->\s*client\s*\(([^)]+)\)$/);
    if (binaryToClientMatch) {
        const [, bytesStr, session] = binaryToClientMatch;
        const bytes = bytesStr.split(',').map(s => parseInt(s.trim(), 10));
        const decoded = decoder.decodePacket(bytes);

        return {
            type: 'binary-to-client',
            direction: 'server->client',
            session: session.trim(),
            timestamp,
            bytes,
            decoded,
            line
        };
    }

    // Pattern: "JSON -> server (session)"
    const jsonToServerMatch = cleanLine.match(/^(\{.+\})\s*->\s*server\s*\(([^)]+)\)$/);
    if (jsonToServerMatch) {
        const [, jsonStr, session] = jsonToServerMatch;
        try {
            return {
                type: 'json-to-server',
                direction: 'client->server',
                session: session.trim(),
                timestamp,
                json: JSON.parse(jsonStr),
                rawJson: jsonStr,
                line
            };
        } catch (e) {
            return {
                type: 'json-to-server',
                direction: 'client->server',
                session: session.trim(),
                timestamp,
                parseError: e.message,
                rawJson: jsonStr,
                line
            };
        }
    }

    // Pattern: Connection events
    const connectionMatch = cleanLine.match(/^(Connecting|Habitat connection|Habitat client disconnected|Destroying connection):\s*(.+)$/);
    if (connectionMatch) {
        return {
            type: 'connection-event',
            event: connectionMatch[1],
            details: connectionMatch[2],
            timestamp,
            line
        };
    }

    // Pattern: User registration
    const userMatch = cleanLine.match(/^user-([^\s]+)\s+known as object ref\s+([^\s]+)\s+in region\/context\s+([^\s.]+)/);
    if (userMatch) {
        return {
            type: 'user-registration',
            username: userMatch[1],
            userRef: userMatch[2],
            context: userMatch[3],
            timestamp,
            line
        };
    }

    // Unrecognized pattern
    return {
        type: 'unknown',
        timestamp,
        line
    };
}

/**
 * Stream parse a log file
 * @param {string} filename - Path to log file
 * @param {Function} callback - Called for each parsed line (entry)
 * @returns {Promise<Object>} Statistics about parsed file
 */
async function parseLogFile(filename, callback) {
    const stats = {
        total: 0,
        types: {},
        sessions: new Set(),
        contexts: new Set()
    };

    const fileStream = fs.createReadStream(filename);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        stats.total++;
        const entry = parseLogLine(line);

        stats.types[entry.type] = (stats.types[entry.type] || 0) + 1;

        if (entry.session) {
            stats.sessions.add(entry.session);
        }

        if (entry.context) {
            stats.contexts.add(entry.context);
        }

        if (callback) {
            callback(entry);
        }
    }

    stats.sessions = Array.from(stats.sessions);
    stats.contexts = Array.from(stats.contexts);

    return stats;
}

/**
 * Filter log entries by criteria
 * @param {Array<Object>} entries - Parsed log entries
 * @param {Object} filter - Filter criteria
 * @returns {Array<Object>} Filtered entries
 */
function filterEntries(entries, filter = {}) {
    return entries.filter(entry => {
        if (filter.type && entry.type !== filter.type) return false;
        if (filter.session && entry.session !== filter.session) return false;
        if (filter.direction && entry.direction !== filter.direction) return false;
        if (filter.noid !== undefined && entry.noid !== filter.noid) return false;
        if (filter.operation && entry.operation !== filter.operation) return false;
        if (filter.context && entry.context !== filter.context) return false;
        return true;
    });
}

/**
 * Group entries by session to create message sequences
 * @param {Array<Object>} entries - Parsed log entries
 * @returns {Object} Map of session -> array of entries
 */
function groupBySession(entries) {
    const sessions = {};

    entries.forEach(entry => {
        if (entry.session) {
            if (!sessions[entry.session]) {
                sessions[entry.session] = [];
            }
            sessions[entry.session].push(entry);
        }
    });

    return sessions;
}

/**
 * Find request/response pairs
 * @param {Array<Object>} entries - Parsed log entries for a session
 * @returns {Array<Object>} Array of {request, response, latency}
 */
function findRequestResponsePairs(entries) {
    const pairs = [];
    const pendingRequests = {};

    entries.forEach(entry => {
        if (entry.type === 'client-to-server' || entry.type === 'json-to-server') {
            // This is a request
            const key = `${entry.noid || 'json'}-${entry.request || entry.json?.op}`;
            pendingRequests[key] = entry;
        } else if (entry.type === 'server-to-client' || entry.type === 'binary-to-client') {
            // Try to match with pending request
            const key = `${entry.decoded?.noid || 'json'}-${entry.decoded?.requestNum || entry.json?.op}`;
            if (pendingRequests[key]) {
                pairs.push({
                    request: pendingRequests[key],
                    response: entry
                });
                delete pendingRequests[key];
            }
        }
    });

    return pairs;
}

module.exports = {
    parseLogLine,
    parseLogFile,
    filterEntries,
    groupBySession,
    findRequestResponsePairs
};

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage: log-parser.js <log-file> [options]');
        console.log('');
        console.log('Options:');
        console.log('  --stats          Show statistics only');
        console.log('  --session NAME   Filter by session');
        console.log('  --type TYPE      Filter by entry type');
        console.log('  --json           Output as JSON');
        console.log('');
        console.log('Examples:');
        console.log('  log-parser.js bridge.log --stats');
        console.log('  log-parser.js bridge.log --session "2087:Chalcedony"');
        console.log('  log-parser.js bridge.log --type binary-to-client');
        process.exit(1);
    }

    const filename = args[0];
    const options = {
        stats: args.includes('--stats'),
        json: args.includes('--json'),
        session: args.includes('--session') ? args[args.indexOf('--session') + 1] : null,
        type: args.includes('--type') ? args[args.indexOf('--type') + 1] : null
    };

    const entries = [];

    parseLogFile(filename, entry => {
        entries.push(entry);
    }).then(stats => {
        if (options.stats) {
            console.log('Log File Statistics:');
            console.log(`  Total lines: ${stats.total}`);
            console.log(`  Entry types:`);
            Object.entries(stats.types).forEach(([type, count]) => {
                console.log(`    ${type}: ${count}`);
            });
            console.log(`  Sessions: ${stats.sessions.length}`);
            console.log(`  Contexts: ${stats.contexts.length}`);
            return;
        }

        // Apply filters
        let filtered = entries;
        if (options.session || options.type) {
            filtered = filterEntries(entries, {
                session: options.session,
                type: options.type
            });
        }

        if (options.json) {
            console.log(JSON.stringify(filtered, null, 2));
        } else {
            filtered.forEach(entry => {
                console.log(JSON.stringify(entry, null, 2));
                console.log('---');
            });
        }
    }).catch(err => {
        console.error('Error parsing log:', err);
        process.exit(1);
    });
}
