#!/usr/bin/env node
/**
 * Habitat Log Analyzer
 *
 * Command-line tool for analyzing Habitat bridge logs and debugging protocol issues.
 */

const fs = require('fs');
const path = require('path');
const decoder = require('./protocol-decoder');
const parser = require('./log-parser');

const COMMANDS = {
    'stats': {
        description: 'Show log file statistics',
        usage: 'stats <log-file>',
        run: cmdStats
    },
    'decode': {
        description: 'Decode binary packet from hex or bytes',
        usage: 'decode <packet-bytes>',
        run: cmdDecode
    },
    'session': {
        description: 'Show all messages for a session',
        usage: 'session <log-file> <session-name>',
        run: cmdSession
    },
    'trace': {
        description: 'Trace request/response pairs for a session',
        usage: 'trace <log-file> <session-name>',
        run: cmdTrace
    },
    'operations': {
        description: 'List all operation types seen in log',
        usage: 'operations <log-file>',
        run: cmdOperations
    },
    'contexts': {
        description: 'List all contexts/regions seen in log',
        usage: 'contexts <log-file>',
        run: cmdContexts
    },
    'grep': {
        description: 'Search for specific operation or pattern',
        usage: 'grep <log-file> <pattern>',
        run: cmdGrep
    },
    'protocol': {
        description: 'Show protocol reference information',
        usage: 'protocol [region|object]',
        run: cmdProtocol
    }
};

async function cmdStats(args) {
    if (args.length < 1) {
        console.error('Usage: stats <log-file>');
        process.exit(1);
    }

    const filename = args[0];
    console.log(`Analyzing ${filename}...\n`);

    const stats = await parser.parseLogFile(filename, null);

    console.log('═══════════════════════════════════════');
    console.log('  LOG FILE STATISTICS');
    console.log('═══════════════════════════════════════');
    console.log(`Total lines: ${stats.total}`);
    console.log('');

    console.log('Entry types:');
    const sortedTypes = Object.entries(stats.types).sort((a, b) => b[1] - a[1]);
    sortedTypes.forEach(([type, count]) => {
        const pct = ((count / stats.total) * 100).toFixed(1);
        console.log(`  ${type.padEnd(25)} ${count.toString().padStart(8)} (${pct}%)`);
    });
    console.log('');

    console.log(`Active sessions: ${stats.sessions.length}`);
    if (stats.sessions.length <= 20) {
        stats.sessions.forEach(s => console.log(`  - ${s}`));
    } else {
        stats.sessions.slice(0, 10).forEach(s => console.log(`  - ${s}`));
        console.log(`  ... and ${stats.sessions.length - 10} more`);
    }
    console.log('');

    console.log(`Contexts/Regions: ${stats.contexts.length}`);
    if (stats.contexts.length <= 20) {
        stats.contexts.forEach(c => console.log(`  - ${c}`));
    } else {
        stats.contexts.slice(0, 10).forEach(c => console.log(`  - ${c}`));
        console.log(`  ... and ${stats.contexts.length - 10} more`);
    }
}

function cmdDecode(args) {
    if (args.length < 1) {
        console.error('Usage: decode <packet-bytes>');
        console.error('Example: decode "85,236,0,1,0,0,32"');
        process.exit(1);
    }

    const byteString = args.join(' ').replace(/[\[\]]/g, '');
    const bytes = byteString.split(',').map(s => parseInt(s.trim(), 10));

    const decoded = decoder.decodePacket(bytes);

    console.log('═══════════════════════════════════════');
    console.log('  PACKET DECODE');
    console.log('═══════════════════════════════════════');
    console.log(decoder.formatPacket(decoded, true));
}

async function cmdSession(args) {
    if (args.length < 2) {
        console.error('Usage: session <log-file> <session-name>');
        console.error('Example: session bridge.log "2087:Chalcedony"');
        process.exit(1);
    }

    const filename = args[0];
    const sessionName = args[1];

    console.log(`Analyzing session: ${sessionName}\n`);

    const entries = [];
    await parser.parseLogFile(filename, entry => {
        if (entry.session === sessionName) {
            entries.push(entry);
        }
    });

    console.log(`Found ${entries.length} messages for session ${sessionName}\n`);
    console.log('═══════════════════════════════════════');

    entries.forEach((entry, i) => {
        console.log(`\n[${i + 1}] ${entry.type} (${entry.direction || 'N/A'})`);

        if (entry.type === 'binary-to-client' && entry.decoded) {
            console.log(decoder.formatPacket(entry.decoded, false));
        } else if (entry.type === 'client-to-server') {
            console.log(`  NOID ${entry.noid} ${entry.operation || 'UNKNOWN'} [seq=${entry.sequence}]`);
            if (entry.payload.length > 0) {
                console.log(`  Payload: [${entry.payload.join(', ')}]`);
            }
        } else if (entry.type === 'server-to-client' || entry.type === 'json-to-server') {
            console.log(`  OP: ${entry.json?.op || 'N/A'}`);
            console.log(`  ${JSON.stringify(entry.json, null, 2).split('\n').join('\n  ')}`);
        } else if (entry.type === 'connection-event') {
            console.log(`  ${entry.event}: ${entry.details}`);
        }
    });
}

async function cmdTrace(args) {
    if (args.length < 2) {
        console.error('Usage: trace <log-file> <session-name>');
        process.exit(1);
    }

    const filename = args[0];
    const sessionName = args[1];

    console.log(`Tracing request/response pairs for: ${sessionName}\n`);

    const entries = [];
    await parser.parseLogFile(filename, entry => {
        if (entry.session === sessionName) {
            entries.push(entry);
        }
    });

    const pairs = parser.findRequestResponsePairs(entries);

    console.log(`Found ${pairs.length} request/response pairs\n`);
    console.log('═══════════════════════════════════════');

    pairs.forEach((pair, i) => {
        console.log(`\n[${i + 1}] REQUEST → RESPONSE`);

        const req = pair.request;
        console.log(`  → ${req.type}: ${req.operation || req.json?.op || 'UNKNOWN'}`);
        if (req.noid !== undefined) {
            console.log(`    NOID: ${req.noid}, Seq: ${req.sequence}`);
        }

        const res = pair.response;
        if (res.type === 'binary-to-client') {
            console.log(`  ← Binary packet: ${res.decoded?.operation || 'UNKNOWN'}`);
            if (res.decoded) {
                console.log(`    ${decoder.formatPacket(res.decoded, false).split('\n').join('\n    ')}`);
            }
        } else {
            console.log(`  ← JSON: ${res.json?.op || 'UNKNOWN'}`);
        }
    });
}

async function cmdOperations(args) {
    if (args.length < 1) {
        console.error('Usage: operations <log-file>');
        process.exit(1);
    }

    const filename = args[0];
    const operations = new Map();

    await parser.parseLogFile(filename, entry => {
        if (entry.operation) {
            const key = entry.operation;
            if (!operations.has(key)) {
                operations.set(key, {
                    count: 0,
                    noid: entry.noid,
                    type: entry.noid === 0 ? 'region' : 'object'
                });
            }
            operations.get(key).count++;
        }
    });

    console.log('═══════════════════════════════════════');
    console.log('  OPERATIONS OBSERVED');
    console.log('═══════════════════════════════════════\n');

    const sorted = Array.from(operations.entries()).sort((a, b) => b[1].count - a[1].count);

    sorted.forEach(([op, info]) => {
        console.log(`${op.padEnd(30)} ${info.count.toString().padStart(6)} (${info.type})`);
    });
}

async function cmdContexts(args) {
    if (args.length < 1) {
        console.error('Usage: contexts <log-file>');
        process.exit(1);
    }

    const filename = args[0];
    const contexts = new Set();

    await parser.parseLogFile(filename, entry => {
        if (entry.context) {
            contexts.add(entry.context);
        }
        if (entry.json?.to && entry.json.to.startsWith('context-')) {
            contexts.add(entry.json.to);
        }
    });

    console.log('═══════════════════════════════════════');
    console.log('  CONTEXTS/REGIONS');
    console.log('═══════════════════════════════════════\n');

    Array.from(contexts).sort().forEach(c => {
        console.log(`  ${c}`);
    });
    console.log(`\nTotal: ${contexts.size} contexts`);
}

async function cmdGrep(args) {
    if (args.length < 2) {
        console.error('Usage: grep <log-file> <pattern>');
        process.exit(1);
    }

    const filename = args[0];
    const pattern = new RegExp(args[1], 'i');
    const matches = [];

    await parser.parseLogFile(filename, entry => {
        if (pattern.test(entry.operation || '') ||
            pattern.test(JSON.stringify(entry.json || '')) ||
            pattern.test(entry.line || '')) {
            matches.push(entry);
        }
    });

    console.log(`Found ${matches.length} matches for pattern: ${args[1]}\n`);
    console.log('═══════════════════════════════════════');

    matches.slice(0, 50).forEach((entry, i) => {
        console.log(`\n[${i + 1}] ${entry.type} (${entry.session || 'N/A'})`);
        if (entry.operation) {
            console.log(`  Operation: ${entry.operation}`);
        }
        if (entry.json) {
            console.log(`  ${JSON.stringify(entry.json, null, 2).split('\n').slice(0, 5).join('\n  ')}`);
        }
    });

    if (matches.length > 50) {
        console.log(`\n... and ${matches.length - 50} more matches`);
    }
}

function cmdProtocol(args) {
    const type = args[0] || 'summary';

    console.log('═══════════════════════════════════════');
    console.log('  HABITAT PROTOCOL REFERENCE');
    console.log('═══════════════════════════════════════\n');

    if (type === 'region' || type === 'summary') {
        console.log('REGION-LEVEL OPERATIONS (NOID = 0):');
        Object.entries(decoder.REGION_OPS).forEach(([code, name]) => {
            console.log(`  ${code.padStart(2)}: ${name}`);
        });
        console.log('');
    }

    if (type === 'object' || type === 'summary') {
        console.log('OBJECT-LEVEL OPERATIONS (NOID > 0):');
        Object.entries(decoder.OBJECT_OPS).forEach(([code, name]) => {
            console.log(`  ${code.padStart(2)}: ${name}`);
        });
        console.log('');
    }

    console.log('For complete protocol documentation, see PROTOCOL.md');
}

function showHelp() {
    console.log('Habitat Log Analyzer');
    console.log('');
    console.log('Usage: habitat-log-analyzer.js <command> [args...]');
    console.log('');
    console.log('Commands:');
    Object.entries(COMMANDS).forEach(([name, cmd]) => {
        console.log(`  ${name.padEnd(15)} ${cmd.description}`);
        console.log(`  ${''.padEnd(15)} Usage: ${cmd.usage}`);
        console.log('');
    });
    console.log('Examples:');
    console.log('  habitat-log-analyzer.js stats bridge.log');
    console.log('  habitat-log-analyzer.js session bridge.log "2087:Chalcedony"');
    console.log('  habitat-log-analyzer.js decode "85,236,0,1"');
    console.log('  habitat-log-analyzer.js grep bridge.log WALK');
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        showHelp();
        process.exit(0);
    }

    const command = args[0];
    const cmdArgs = args.slice(1);

    if (!COMMANDS[command]) {
        console.error(`Unknown command: ${command}`);
        console.error('Run with --help to see available commands');
        process.exit(1);
    }

    try {
        await COMMANDS[command].run(cmdArgs);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        if (process.env.DEBUG) {
            console.error(err.stack);
        }
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    COMMANDS,
    main
};
