
/** recoverTurfs.js - Reclaim turfs (and delete the users/avatars holding them) from
 *  abandoned single-visit accounts in the NeoHabitat Elko Mongo database.
 *
 *  A user is a reclamation candidate when ALL of the following hold:
 *    - their Avatar mod has a real turf (not empty / not "context-test")
 *    - they connected on at most one distinct day (stats[HS$lifetime] <= 1,
 *      or no stats at all — i.e. Elko never checkpointed a second visit)
 *    - their last connection (Avatar.lastConnectedDay, days-since-epoch) is
 *      more than --days ago (default 90)
 *    - they are not a god account (nitty_bits GOD_BIT) and not in --keep
 *
 *  Reclaiming means:
 *    1. delete every item document contained (recursively) in the user doc
 *    2. delete the user doc itself
 *    3. clear mods.0.resident on the turf Region (targeted $set, nothing else
 *       touched) — which returns the turf to the available pool, since the
 *       bridge assigns turfs by querying for is_turf regions with an
 *       empty/missing resident (bridge_v2 ensureTurfAssigned)
 *
 *  DRY RUN by default: prints the report and touches nothing. Add --apply to
 *  actually reclaim.
 */

globalThis.crypto ??= require('crypto').webcrypto;	// mongodb driver 7.x on Node 18

const MongoClient	= require('mongodb').MongoClient;

const USAGE = `
Reclaims turfs from abandoned single-visit accounts (dry run unless --apply)

Usage: node recoverTurfs.js [options]
  --days=N       minimum days since last connection (default 90)
  --apply        actually delete users and free turfs (default: dry run)
  --keep=NAME    user ref or name to never reclaim (repeatable)
  --url=URL      mongodb server url (default //neohabitatmongo/elko)
  --help         this message
`;

const Argv = {days: 90, apply: false, keep: [], url: '//neohabitatmongo/elko'};
for (const arg of process.argv.slice(2)) {
	const m = arg.match(/^--([a-z]+)(?:=(.*))?$/);
	if (!m || !(m[1] in Argv) && m[1] !== 'help') {
		console.log(`Unknown option: ${arg}\n${USAGE}`);
		process.exit(1);
	}
	if (m[1] === 'help') { console.log(USAGE); process.exit(0); }
	if (m[1] === 'apply') Argv.apply = true;
	else if (m[1] === 'keep') Argv.keep.push(m[2]);
	else if (m[1] === 'days') Argv.days = parseInt(m[2], 10);
	else Argv[m[1]] = m[2];
}
if (!(Argv.days > 0)) { console.log(`Bad --days value\n${USAGE}`); process.exit(1); }

const HS$LIFETIME	= 1;		// Constants.java: stats index, distinct days connected
const GOD_BIT		= 8;		// nitty_bits god flag (writeHabitatUser.js --god)
const DEFAULT_TURF	= 'context-test';
const ONE_DAY		= 1000 * 60 * 60 * 24;

const url = 'mongodb:' + Argv.url;
const keep = new Set(Argv.keep.map(n =>
	n.startsWith('user-') ? n : 'user-' + n.toLowerCase().replace(/ /g, '_')));

function avatarOf(doc) {
	return (doc.mods && doc.mods[0] && doc.mods[0].type === 'Avatar') ? doc.mods[0] : null;
}

function hasRealTurf(av) {
	return av.turf && av.turf !== '' && av.turf !== DEFAULT_TURF;
}

/** Collect refs of everything contained in containerRef, recursively. */
async function containedRefs(odb, containerRef) {
	const refs = [];
	const children = await odb.find({in: containerRef}, {projection: {ref: 1}}).toArray();
	for (const child of children) {
		refs.push(child.ref);
		refs.push(...await containedRefs(odb, child.ref));
	}
	return refs;
}

(async () => {
	const client = await MongoClient.connect(url);
	const odb = client.db('elko').collection('odb');
	const today = Math.floor(Date.now() / ONE_DAY);
	const cutoffDay = today - Argv.days;

	const users = await odb.find({type: 'user'}).toArray();
	const candidates = [];
	for (const user of users) {
		const av = avatarOf(user);
		if (!av || !hasRealTurf(av)) continue;
		if (keep.has(user.ref)) continue;
		if ((av.nitty_bits || 0) & GOD_BIT) continue;
		const lifetime = (av.stats && av.stats[HS$LIFETIME]) || 0;
		if (lifetime > 1) continue;
		// No lastConnectedDay means Elko never checkpointed an arrival; only
		// reclaim those when explicitly idle-verified is impossible, so skip.
		if (!av.lastConnectedDay) continue;
		if (av.lastConnectedDay > cutoffDay) continue;
		candidates.push({user, av});
	}

	console.log(`${candidates.length} candidate(s): single-visit users idle > ${Argv.days} days, holding a turf\n`);

	let freed = 0;
	for (const {user, av} of candidates) {
		const items = await containedRefs(odb, user.ref);
		const region = await odb.findOne({ref: av.turf});
		const resident = region && region.mods && region.mods[0] && region.mods[0].resident;
		const lastSeen = new Date(av.lastConnectedDay * ONE_DAY).toISOString().slice(0, 10);
		const turfNote = !region ? 'MISSING REGION'
			: resident === user.ref ? 'resident matches'
			: `resident is ${JSON.stringify(resident || '')} — region left untouched`;
		console.log(`${user.ref} ("${user.name}")  last seen ${lastSeen}  turf ${av.turf} (${turfNote})  ${items.length} item(s)`);

		if (!Argv.apply) continue;

		if (items.length > 0) {
			await odb.deleteMany({ref: {$in: items}});
		}
		await odb.deleteOne({ref: user.ref});
		// Free the turf only if it still points back at this user; a stale or
		// foreign resident (e.g. after a Bureaucrat address change) is left alone.
		if (region && resident === user.ref) {
			await odb.updateOne({ref: av.turf}, {$set: {'mods.0.resident': ''}});
			freed++;
		}
	}

	if (Argv.apply) {
		console.log(`\nReclaimed ${candidates.length} user(s), freed ${freed} turf(s).`);
	} else if (candidates.length > 0) {
		console.log('\nDry run — nothing changed. Re-run with --apply to reclaim.');
	}
	await client.close();
})();
