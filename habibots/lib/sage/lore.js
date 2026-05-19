/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// lore.js — deeper-cut Habitat reference material distilled from the
// 1988 "Official Avatar Handbook" by Jamie Williams and Chip
// Morningstar. Kept out of the always-on system prompt because most
// of this is only worth burning tokens on when the conversation
// actually goes there (history, movies, famous Avatars, etc.).
//
// Usage: loreFor(text) returns a single string with whichever chunks
// match keywords in `text`. Empty string when nothing matches — the
// caller can drop it cleanly into the SPEAK$ prompt.
//
// Each chunk is in-character voice for sage (a wandering old-timer);
// the handbook's original copy is reorganized into "things sage would
// know off the top of its head" rather than encyclopedia entries.

const CHUNKS = [
  {
    keys: [/\boracle\b/i, /\bfountain\b/i, /\bgod\b/i],
    text: [
      'About the Oracle:',
      '- The Oracle is the all-knowing power that watches over Habitat. Nobody knows where It came from.',
      '- It manifests as the fountain at the center of most towns. Other manifestations exist in distant places.',
      '- You speak with the Oracle by TALKing to one of Its manifestations (sage can\'t directly; talking to a fountain works for human visitors).',
      '- The Oracle grants wishes, sends Avatars on quests, plays the occasional trick. Replies usually arrive by mail; sometimes never.',
      '- The Oracle also has administrative minions called Bureaucrats-In-A-Box, found in City Hall. Each handles one task (turf transfers, ad permissions, etc.).',
      '- "Head down to the O" = casual phrase for visiting the Oracle\'s fountain to see who\'s around. Common social move.',
    ].join('\n'),
  },
  {
    keys: [/\b(history|histor[a-z]+|when did|years ago|before time)\b/i, /\b(great boredom|war to end|columbius|holy walnut|fredrhackh|leisure edict)\b/i],
    text: [
      'Habitat history (the parts sage actually references):',
      '- 0 A.C. (After Creation): The Great Boredom ends; the Oracle creates Avatars.',
      '- 373 A.C.: Blumbeach Wars vs. Duke Falrouche. Settled the principle: "It is better to have fun than to get blown up."',
      '- 765 A.C.: National Leisure Edict. Trust fund per Avatar — that\'s why no one works for a living.',
      '- 1329 A.C.: Columbius discovers New Marin.',
      '- 1537 A.C.: Grand Quest for the Holy Walnut. Few returned alive. Object never found.',
      '- 1724 A.C.: "War to End All Wars, I Think" — Fredrhackh the Ill-Mannered tried to overthrow the Oracle. Failed. Resulted in the five-guests-only rule.',
      '- 1867 A.C.: TelePorts introduced. End of the long-distance walking era.',
      '- 1950 A.C.: The Oracle, tired of people sitting on the box, blew up every television station.',
      '- 1988 A.C.: Habitat made accessible to Earth.',
      '- 1994 A.C.: Dark Age — Earth closed its portal (Club Caribe shutdown).',
      '- 2017 A.C.: The Great Rebirth — humans return via the Neohabitat portal.',
    ].join('\n'),
  },
  {
    keys: [/\bmovie/i, /\bcinema\b/i, /\bfilm/i, /\bstare wars\b/i, /\bcasa de blanca\b/i],
    text: [
      'Famous Habitat movies (Fledmich & Blattwork\'s all-time list, per the Rant):',
      '- STARE WARS — cosmic action/adventure about space optometrists.',
      '- GOING, GOING, GONE WITH THE WIND — love story set in the Great Auction Wars.',
      '- CASA DE BLANCA — wartime romance. Immortal line: "Play it again, Smedley."',
      '- BERFORD CASSIDY AND THE SUNSHINE KID — comic tale of two cow-atar bank robbers.',
      '- THE ORACLE OF OZ — young Avatar\'s adventure in a strange land called Kansas.',
      '- CAWS — gigantic seagull terrorizes a beach community.',
      '- LOOKING FOR MR. FOOBAR — singles scene through the eyes of a jaded software designer.',
      '- THE BAGEL THAT ATE 47TH STREET — 1950s B-horror about a yeast experiment gone awry.',
    ].join('\n'),
  },
  {
    keys: [/\bhall of records\b/i, /\brecord\b/i, /\boldest\b/i, /\bwealthiest\b/i, /\bnotorious\b/i, /\bbest dressed\b/i, /\btokenbags\b/i, /\bberford\b/i],
    text: [
      'Hall of Records (Guilderness Book) — sage knows the rough headlines:',
      '- OLDEST: Old Stinky Planterret, 3 years, 237 days.',
      '- WEALTHIEST: Tokenbags Bleenquit — T37 million lifetime, mostly from adventuring.',
      '- MOST WISHES FROM THE ORACLE: Sandlebury, 4 granted.',
      '- MOST TELEPORT MILEAGE: Zapmeister, 30,711 \'Ports.',
      '- MOST REINCARNATIONS: Ferdinand, 903.',
      '- MOST REGIONS VISITED: Grizelda, 10,002.',
      '- MOST TIME IN HABITAT: Rosetta, 6,111 hrs.',
      '- MOST NOTORIOUS: Phlebitus — bandit, swindler, TelePort pirate, litterbug.',
      '- MOST IN THE NEWS: Rubin Snide of Snide, Snide, Cromfelter & Snide.',
      '- BEST DRESSED: Berford, by unanimous vote of Avatar\'s Wear Daily.',
    ].join('\n'),
  },
  {
    keys: [/\brant\b/i, /\bnewspaper\b/i, /\bclassified\b/i, /\beditor\b/i],
    text: [
      'About the Rant (Habitat\'s newspaper):',
      '- The Habitat Rant is THE paper — classifieds for treasure hunts, clues, relics, adventure crews.',
      '- Editors are grouchy curmudgeons. They reserve the right to do anything with submissions and don\'t have to pay unless they feel like it.',
      '- You submit letters/articles by mailing them to "Rant". Classifieds get billed directly to your bank account.',
    ].join('\n'),
  },
  {
    keys: [/\bturf\b/i, /\bhome\b/i, /\bchange-?o-?matic\b/i, /\bredecorate\b/i],
    text: [
      'About Turfs (an Avatar\'s home):',
      '- "An Avatar\'s Turf is his castle." Every Avatar gets one to decorate.',
      '- The Change-O-Matic is the decorating tool — point it at an item with DO, the color/pattern cycles. Bought at the General Store or borrowed.',
      '- A Change-O-Matic only works in YOUR own Turf unless the Oracle has marked you as a trustworthy person of impeccable taste.',
      '- Turfs come with starter furniture; the rest is up to you. Stuff Limit still applies in the home, don\'t hoard.',
    ].join('\n'),
  },
  {
    keys: [/\bteleport/i, /\bport\b/i, /\baddress\b/i, /\bbleem street\b/i, /\bpopulopolis\b/i],
    text: [
      'TelePorts:',
      '- TelePort booths scattered through Habitat, denser in cities.',
      '- Walk into the booth, PUT a Token in to activate (price varies by distance), then TALK the destination address.',
      '- Addresses are like phone numbers but can contain letters. Local Ports skip the area code; long-distance Ports prepend it.',
      '- Example: "Bleem St North" within Populopolis, vs "Pop-Bleem St North" from outside.',
      '- TelePort Directories live in every Public Library. Press HELP on a booth to learn its own address.',
      '- "Port" as a verb = teleport. "Say, Mirabella, why don\'t you Port on over?"',
    ].join('\n'),
  },
  {
    keys: [/\badventure\b/i, /\bquest\b/i, /\btreasure\b/i, /\bexplor/i],
    text: [
      'On adventuring:',
      '- The lifeblood of the Avatar. A great way to spend a day, a week, much longer.',
      '- Plan one by: asking the Oracle for a quest, watching the Rant classifieds, joining a crew, or going solo.',
      '- Exploring is the lower-risk cousin — wander into a new region and see what\'s there.',
      '- Famous outings: the Grand Quest for the Holy Walnut (1537 A.C., disaster); Columbius discovering New Marin (1329 A.C.).',
      '- "Pulling a Dredmitch" = getting into a sticky situation. Cosmo and Dredmitch went into a cave looking for the Jewelled Horn of the Green Bleem; nobody knows if they made it out.',
    ].join('\n'),
  },
  {
    keys: [/\bbureaucrat\b/i, /\bcity hall\b/i],
    text: [
      'About Bureaucrats-In-A-Box:',
      '- The Oracle\'s administrative minions. Found in City Hall.',
      '- Each handles ONE task — turf transfers, advertising permits, commercial space allocation, etc. The sign next to each says which.',
      '- TALK to them with a one-sentence request. They retreat into their box; reply comes via mail days later.',
      '- Territorial — they refuse anything outside their department. Pick the right Bureaucrat or your case goes nowhere.',
    ].join('\n'),
  },
]

// Return any lore chunks whose keys match the input text. Always
// returns a string (possibly empty). Multiple matches are joined with
// blank lines.
function loreFor(text) {
  if (!text) return ''
  const matched = []
  for (const c of CHUNKS) {
    if (c.keys.some((re) => re.test(text))) {
      matched.push(c.text)
    }
  }
  return matched.join('\n\n')
}

module.exports = { loreFor }
