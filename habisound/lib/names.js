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
  // Avatar class indices 6–9 (action_head.i); class_avatar uses message_sent ×3 + message_received.
  ESP_ACTIVATES: 'message_sent',
  ESP_MESSAGE_SENT: 'message_sent',
  ESP_MESSAGE_RECEIVED: 'message_received',
  ESP_MESSAGE_RECIEVED: 'message_received', // C64 typo in action_head.i
  ESP_DEACTIVATES: 'message_sent',
  ELEVATOR_ARRIVAL: 'teleport_arrival',
  ELEVATOR_CONF_WAIT: 'teleport_conf_wait',
  ELEVATOR_DEPARTING: 'teleport_departure',
  ESCAPE_DEVICE_ACTIVATES: 'escape_device_activates',
  // Only the grenade emits EXPLOSION; grenade_EXPLODE.m plays complexSound 0,
  // which is the grenade class's sound 0 = big_explosion (per habitat_beta.mud).
  EXPLOSION: 'big_explosion',
  EXIT_OPENING: 'door_opening',
  EXIT_CLOSING: 'door_closing',
  FORTUNE_DISPENSED: 'fortune_dispensed',
  GARBAGE_FLUSH: 'garbage_can_flush',
  GENIE_APPEARS: 'genie_appears',
  GENIE_OUT: 'genie_out',
  GUNSHOT: 'gunshot',
  GUN_SAFETY_OFF: 'gun_safety_off',
  GUN_SAFETY_ON: 'gun_safety_on',
  // The pawn machine never had its own sound: habitat_beta.mud aliases the
  // resource `pawn_machine_munching` to the parking-meter crank .bin/.pwbin.
  PAWN_MUNCH: 'parking_meter_crank',
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
  // SWITCHED_ON/OFF are class-relative (see resolve()); not fixed aliases.
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
  // The safe reuses the box sounds in beta.mud (class_safe: box_opening/closing),
  // even though standalone safe_opening/safe_closing.sob exist. Match beta.mud.
  ['safe', 'box'],
  // hole, dropbox, etc. also reuse the box sounds.
];

function containerPrefix(classHint) {
  const h = (classHint || '').toLowerCase();
  for (const [needle, prefix] of CONTAINER_PREFIX) {
    if (h.includes(needle)) return prefix;
  }
  return 'box';
}

// 2b) SWITCHED_ON/OFF are class-relative sound indices 0 and 1 (action_head.i:
// "define SWITCHED_ON = 0 ; for securDev, camera, stereo"). In the data the
// security device has dedicated on/off sounds while the movie camera (and other
// generic switchables) just click. Resolve by class hint, defaulting to a click.
function switched(classHint, on) {
  const h = (classHint || '').toLowerCase();
  if (h.includes('security')) return on ? 'security_device_on' : 'security_device_off';
  return 'switch_click'; // movie_camera and generic switchables click for both
}

// 3) Names habiworld emits that have NO original .sob, or whose source name in
// classes.js differs from the file. Aliased where a file exists; null where the
// original sound was never built (kept here so callers can detect the gap).
export const FILE_ALIASES = {
  garbage_can_flushing: 'garbage_can_flush',     // classes.js spelling -> real file
  pawn_machine_munching: 'parking_meter_crank',  // habitat_beta.mud aliases it here
};

// Symbolic names that intentionally resolve to nothing because the object is
// obsolete and never had a canonical sound (so a client can no-op quietly).
export const OBSOLETE = {
  MUSIC: 'jukebox is obsolete — no instances, no mod, no sound resource in the .mud',
};

// Symbolic names we cannot satisfy from the original data. Empty: every name
// habiworld emits either resolves to a real sound or is listed in OBSOLETE.
export const UNRESOLVED = {};

export function resolve(name, opts = {}) {
  if (name == null) return null;
  const { classHint } = opts;

  if (name === 'CONTAINER_OPENING') return `${containerPrefix(classHint)}_opening`;
  if (name === 'CONTAINER_CLOSING') return `${containerPrefix(classHint)}_closing`;
  if (name === 'SWITCHED_ON') return switched(classHint, true);
  if (name === 'SWITCHED_OFF') return switched(classHint, false);
  // MUSIC (jukebox) has no canonical sound: the jukebox is obsolete — no
  // instances in any region, no Jukebox mod, and no sound resource in the .mud
  // (jukebox_do plays nothing). habiworld's ctx.sound('MUSIC') is speculative;
  // we resolve it to null rather than invent one. See OBSOLETE below.
  if (name in OBSOLETE) return null;

  if (name in ALIASES) return ALIASES[name];
  if (name in UNRESOLVED) return null;
  if (name in FILE_ALIASES) return FILE_ALIASES[name];

  // Already a bank key (lowercase file stem)? Pass it through.
  if (name === name.toLowerCase()) return name;

  return null;
}
