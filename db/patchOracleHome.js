/**
 * patchOracleHome.js — one-time migration adding the Oracle avatar and its
 * region to an EXISTING database.
 *
 * `make db` runs `nuke` first, so it is not an option against prod. This
 * touches only the handful of records the Oracle feature introduces and
 * never deletes anything.
 *
 * Usage (dry run — reports what it would do, writes nothing):
 *   node patchOracleHome.js --url=//127.0.0.1:27017/elko
 * Then, to actually write:
 *   node patchOracleHome.js --url=//127.0.0.1:27017/elko --apply
 *
 * Records come from the repo's own JSON so there is one source of truth:
 *   db/Users/user-oracle.json         user-oracle + its Paper and Head
 *   db/Backroom/context-oraclehome.json   the region + ground, wall, sign
 *
 * Safe to re-run: an existing record is left alone unless --force. That
 * matters most for item-oracle.paper. PSENDMAIL destroys the sheet you
 * mail and Paper.GET's special_get mints the replacement under a generated
 * `i-<id>` ref, so a live Oracle no longer owns the seeded ref. Blindly
 * re-inserting it would leave TWO Papers in MAIL_SLOT, which is the state
 * the drain logic exists to prevent — so the Paper is skipped whenever the
 * Oracle already owns one under any ref.
 *
 * Once prod is patched this script has done its job and can be deleted.
 */

const fs = require('fs');
const path = require('path');
const MongoClient = require('mongodb').MongoClient;

// Args are parsed by hand rather than with yargs: yargs 18 is ESM-only and
// cannot be require()d under node 18, and a one-shot migration should run
// on whatever node the server happens to have. That leaves `mongodb` as
// this script's only dependency.
const USAGE = [
  '',
  'Adds user-oracle and context-oraclehome to an existing Habitat database.',
  '',
  '  --url=//HOST:PORT/DB   mongodb server url (default //127.0.0.1:27017/elko)',
  '  --apply                actually write; without it this is a dry run',
  '  --force                overwrite records that already exist',
  '  --undo                 remove everything this script added, and any',
  '                         state the Oracle accumulated while running',
  '  --help                 this message',
  '',
].join('\n');

function parseArgs(argv) {
  const opts = { url: '//127.0.0.1:27017/elko', apply: false, force: false, undo: false, help: false };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'url' && value) opts.url = value;
    else if (key === 'apply') opts.apply = true;
    else if (key === 'force') opts.force = true;
    else if (key === 'undo') opts.undo = true;
    else if (key === 'help' || key === 'h') opts.help = true;
    else { console.error(`Unrecognised argument: ${arg}\n${USAGE}`); process.exit(1); }
  }
  return opts;
}

const Argv = parseArgs(process.argv.slice(2));
if (Argv.help) { console.log(USAGE); process.exit(0); }

const SOURCES = [
  path.join(__dirname, 'Users', 'user-oracle.json'),
  path.join(__dirname, 'Backroom', 'context-oraclehome.json'),
];

const ORACLE_USER_REF = 'user-oracle';
const ORACLE_REGION_REF = 'context-oraclehome';
const ORACLE_NAME = 'oracle';   // lowercased display name: mail-<name>, paper-item-<name>.*
const MAIL_SLOT = 4;            // Constants.java

function load(file) {
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(records)) throw new Error(`${file} is not an array of records`);
  for (const r of records) if (!r.ref) throw new Error(`${file} has a record with no ref`);
  return records;
}

// The Oracle's MAIL_SLOT Paper must stay unique — see the header. Returns every
// Paper the Oracle owns, so the caller can tell whether seeding one more would
// put a second sheet in the mail slot.
async function oraclePapers(odb) {
  return odb.find({
    in: new RegExp(`^${ORACLE_USER_REF}`),
    'mods.0.type': 'Paper',
  }).toArray();
}

// The region is only isolated as long as nothing links to it.
async function checkIsolation(odb) {
  const warnings = [];
  const linked = await odb
    .find({ 'mods.0.neighbors': ORACLE_REGION_REF }, { projection: { ref: 1 } })
    .toArray();
  for (const r of linked) {
    warnings.push(`${r.ref} lists ${ORACLE_REGION_REF} as a neighbour — it is reachable on foot`);
  }
  const teleports = await odb.findOne({ ref: 'teleports' });
  if (teleports && teleports.map) {
    for (const [addr, target] of Object.entries(teleports.map)) {
      if (target === ORACLE_REGION_REF) {
        warnings.push(`teleport address "${addr}" points at ${ORACLE_REGION_REF}`);
      }
    }
  }
  return warnings;
}

(async () => {
  const url = 'mongodb:' + Argv.url;
  const dbName = url.split('/').pop() || 'elko';
  const client = await MongoClient.connect(url);
  const odb = client.db(dbName).collection('odb');
  console.log(`Connected to ${url} (collection: odb)\n`);

  let records = [];
  for (const file of SOURCES) records = records.concat(load(file));

  if (Argv.undo) {
    // The inverse of a patch run, scoped so it can only ever touch the
    // Oracle. Beyond the seeded refs this also clears what the Oracle
    // accumulates once it is live — mail it was sent, the letter bodies,
    // and the `i-<id>` Paper that special_get mints to replace a mailed
    // sheet — because those are exactly the records a re-patch would
    // otherwise trip over.
    const targets = [];
    for (const record of records) targets.push({ filter: { ref: record.ref }, label: record.ref });
    targets.push({ filter: { in: new RegExp(`^${ORACLE_USER_REF}`) }, label: "anything contained in user-oracle (its Paper/Head, incl. i-<id> replacements)" });

    // Letter BODIES are stored as `paper-i-<id>` — a shape shared by every
    // avatar's mail, with nothing in the ref tying one to its author. So
    // they must never be matched by pattern: `^paper-` would delete other
    // players' letters, including ones the Oracle has already delivered and
    // which are now the recipient's property. Instead, resolve the exact
    // refs still listed in the Oracle's own undelivered queue.
    const queue = await odb.findOne({ ref: `mail-${ORACLE_NAME}` });
    const orphanBodies = ((queue && queue.queue) || []).map((entry) => entry.paper_ref).filter(Boolean);
    if (orphanBodies.length) {
      targets.push({ filter: { ref: { $in: orphanBodies } }, label: `${orphanBodies.length} undelivered letter body/bodies addressed to the Oracle` });
    }
    targets.push({ filter: { ref: `mail-${ORACLE_NAME}` }, label: `mail-${ORACLE_NAME} (its mail queue)` });

    let total = 0;
    for (const t of targets) {
      const n = await odb.countDocuments(t.filter);
      total += n;
      console.log(`  ${String(n).padStart(3)}  ${t.label}`);
    }
    console.log(`\n${total} record(s) would be removed.`);
    console.log('\nNOT touched: any letter a player already received from the Oracle.');
    console.log('Those are ordinary mail in that player\'s own pocket and queue, and their');
    console.log('bodies are indistinguishable by ref from everyone else\'s.');
    if (!Argv.apply) {
      console.log('\nDry run — nothing removed. Re-run with --undo --apply to commit.');
      await client.close();
      return;
    }
    for (const t of targets) {
      const res = await odb.deleteMany(t.filter);
      if (res.deletedCount) console.log(`  removed ${res.deletedCount}: ${t.label}`);
    }
    const left = await odb.countDocuments({ $or: [{ ref: /oracle/ }, { in: new RegExp(`^${ORACLE_USER_REF}`) }] });
    console.log(`\nOracle-related records remaining: ${left} (expect 0)`);
    await client.close();
    return;
  }

  const papers = await oraclePapers(odb);
  const plan = [];
  for (const record of records) {
    const existing = await odb.findOne({ ref: record.ref }, { projection: { ref: 1 } });
    const isSeedPaper = record.in === ORACLE_USER_REF && record.mods[0].type === 'Paper';
    // A live Oracle no longer owns the seeded ref (PSENDMAIL destroys the sheet
    // you mail and special_get mints the replacement as `i-<id>`), and its own
    // sheet moves between slots as it works. Writing the seed record back would
    // slam it into MAIL_SLOT alongside whatever is already there — the exact
    // two-Papers-in-one-slot state the bot's drain logic exists to prevent. So
    // this is checked BEFORE --force: forcing must never be able to cause it.
    const otherPaperInMailSlot = papers.find((p) =>
      p.ref !== record.ref && p.mods[0].y === MAIL_SLOT);
    if (isSeedPaper && otherPaperInMailSlot) {
      plan.push({ record, action: 'skip', why: `the Oracle already has a Paper in MAIL_SLOT (${otherPaperInMailSlot.ref}); writing this one would make two` });
    } else if (!existing) {
      plan.push({ record, action: 'insert', why: 'not present' });
    } else if (Argv.force) {
      plan.push({ record, action: 'replace', why: 'exists, --force given' });
    } else {
      plan.push({ record, action: 'skip', why: 'already present (use --force to overwrite)' });
    }
  }

  for (const p of plan) {
    console.log(`  ${p.action.toUpperCase().padEnd(7)} ${p.record.ref.padEnd(34)} ${p.why}`);
  }

  const writes = plan.filter((p) => p.action !== 'skip');
  console.log(`\n${writes.length} record(s) to write, ${plan.length - writes.length} unchanged.`);

  const warnings = await checkIsolation(odb);
  if (warnings.length) {
    console.log('\nWARNING — the Oracle region is meant to be unreachable:');
    for (const w of warnings) console.log('  ! ' + w);
  }

  if (!Argv.apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.');
    await client.close();
    return;
  }

  for (const p of writes) {
    // replaceOne, never $set: a partial update against elko's odb leaves
    // omitted fields behind on the old document.
    await odb.replaceOne({ ref: p.record.ref }, p.record, { upsert: true });
    console.log(`  wrote ${p.record.ref}`);
  }

  const user = await odb.findOne({ ref: ORACLE_USER_REF });
  const region = await odb.findOne({ ref: ORACLE_REGION_REF });
  const finalPapers = await oraclePapers(odb);
  const inMailSlot = finalPapers.filter((p) => p.mods[0].y === MAIL_SLOT).length;
  console.log('\nVerification:');
  console.log(`  ${ORACLE_USER_REF}: ${user ? 'present' : 'MISSING'}` +
    (user ? `, nitty_bits=${user.mods[0].nitty_bits} (HIDDEN_AVATAR=${1 << 29}), turf=${user.mods[0].turf}` : ''));
  console.log(`  ${ORACLE_REGION_REF}: ${region ? 'present' : 'MISSING'}` +
    (region ? `, neighbors=${JSON.stringify(region.mods[0].neighbors)}, is_turf=${region.mods[0].is_turf === true}` : ''));
  console.log(`  Papers owned by the Oracle: ${finalPapers.length}, of which ${inMailSlot} in MAIL_SLOT (must be exactly 1)`);
  console.log('\nThe elko image must already carry HIDDEN_AVATAR, or the Oracle will show up in F3.');

  await client.close();
})().catch((err) => {
  console.error('patchOracleHome failed:', err.message);
  process.exit(1);
});
