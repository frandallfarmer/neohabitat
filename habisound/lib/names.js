// names.js — resolve the symbolic sound names that habiworld behaviors emit
// (e.g. ctx.sound('TELEPORT_ARRIVAL', noid)) to the actual sound-bank keys.
//
// habiworld/BEHAVIORS.md notes the sound resource table was "deferred"; this is
// that table. Names fall into three groups:
//   1. direct 1:1 aliases to a bank entry,
//   2. generic names that depend on the object's class (containers, explosions),
//   3. a few names with no original .sob (flagged in UNRESOLVED) — best-effort.
//
// resolve(name, { classHint }) returns a bank key (string) or null.

// 1) Direct symbolic -> bank-key aliases (UPPER_SNAKE -> file stem).
export const ALIASES = {
  CHANGOMATIC: 'changomatic',
  CLOTHES_DOFFED: 'clothes_doffed',
  CLOTHES_DONNED: 'clothes_donned',
  COIN_ACCEPTED: 'coin_accepted_by_coinop',
  COIN_DEPOSITED: 'coin_deposited_in_coinop',
  COIN_REJECTED: 'coin_rejected_by_coinop',
  DIGGING: 'digging',
  ELEVATOR_ARRIVAL: 'teleport_arrival',
  ELEVATOR_CONF_WAIT: 'teleport_conf_wait',
  ELEVATOR_DEPARTING: 'teleport_departure',
  ESCAPE_DEVICE_ACTIVATES: 'escape_device_activates',
  EXIT_OPENING: 'door_opening',
  EXIT_CLOSING: 'door_closing',
  FORTUNE_DISPENSED: 'fortune_dispensed',
  GARBAGE_FLUSH: 'garbage_can_flush',
  GENIE_APPEARS: 'genie_appears',
  GENIE_OUT: 'genie_out',
  GUNSHOT: 'gunshot',
  GUN_SAFETY_OFF: 'gun_safety_off',
  GUN_SAFETY_ON: 'gun_safety_on',
  JOKE_GUNSHOT: 'joke_gunshot',
  MAGIC: 'magic',
  MAIL_OUT_OF_MAILBOX: 'mail_out_of_mailbox',
  MONEY_INTO_ATM: 'money_into_atm',
  MONEY_OUT_OF_ATM: 'money_out_of_atm',
  SENSOR_DIDNT_FIND_IT: 'sensor_didnt_find_it',
  SENSOR_FOUND_IT: 'sensor_found_it',
  SENSOR_SCANNING: 'sensor_scanning',
  SEX_CHANGER: 'sex_changer',
  SPRAY: 'spraycan',
  STINGY_COKE_MACHINE: 'stingy_coke_machine',
  STUN_GUN_FIRE: 'stun_gun_fire',
  STUN_GUN_HIT: 'stun_gun_hit',
  STUN_GUN_MISS: 'stun_gun_miss',
  SWITCH_CLICK: 'switch_click',
  // security devices toggle with these; ordinary light switches use SWITCH_CLICK.
  SWITCHED_ON: 'security_device_on',
  SWITCHED_OFF: 'security_device_off',
  TELEPORT_ACTIVATES: 'teleport_activates',
  TELEPORT_ARRIVAL: 'teleport_arrival',
  TELEPORT_DEPARTING: 'teleport_departure',
  VENDO_CHANGING: 'vendo_changing',
  VENDO_DISPENSING: 'vendo_dispensing',
};

// 2a) CONTAINER_OPENING/CLOSING resolve per class. Map a class hint (matched as
// a lowercase substring) to the file-stem prefix; default to a generic box.
const CONTAINER_PREFIX = [
  ['bag', 'bag'],
  ['chest', 'chest_of_drawers'],
  ['box', 'box'],
  ['safe', 'safe'],
  // hole, dropbox, etc. reuse the box sounds in classes.js
];

function containerPrefix(classHint) {
  const h = (classHint || '').toLowerCase();
  for (const [needle, prefix] of CONTAINER_PREFIX) {
    if (h.includes(needle)) return prefix;
  }
  return 'box';
}

// 2b) EXPLOSION size by class hint; default medium.
function explosion(classHint) {
  const h = (classHint || '').toLowerCase();
  if (h.includes('grenade') || h.includes('bomb')) return 'big_explosion';
  if (h.includes('fire') || h.includes('cracker')) return 'small_explosion';
  return 'medium_explosion';
}

// 3) Names habiworld emits that have NO original .sob, or whose source name in
// classes.js differs from the file. Aliased where a file exists; null where the
// original sound was never built (kept here so callers can detect the gap).
export const FILE_ALIASES = {
  garbage_can_flushing: 'garbage_can_flush', // classes.js spelling -> real file
  pawn_machine_munching: null,               // no .sob exists in the C64 sources
};

// Symbolic names we cannot satisfy from the original data (for documentation
// and so a client can warn instead of silently doing nothing).
export const UNRESOLVED = {
  PAWN_MUNCH: 'no pawn_machine_munching.sob in the C64 sources',
};

export function resolve(name, opts = {}) {
  if (name == null) return null;
  const { classHint } = opts;

  if (name === 'CONTAINER_OPENING') return `${containerPrefix(classHint)}_opening`;
  if (name === 'CONTAINER_CLOSING') return `${containerPrefix(classHint)}_closing`;
  if (name === 'EXPLOSION') return explosion(classHint);
  if (name === 'MUSIC') return 'region_change_music_v0'; // TODO: confirm which track per context

  if (name in ALIASES) return ALIASES[name];
  if (name in UNRESOLVED) return null;
  if (name in FILE_ALIASES) return FILE_ALIASES[name];

  // Already a bank key (lowercase file stem)? Pass it through.
  if (name === name.toLowerCase()) return name;

  return null;
}
