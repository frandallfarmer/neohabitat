/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// tools.js — Claude tool definitions + dispatcher for SageBot.
//
// The wrap pattern: each tool is one entry in the TOOLS array (name +
// JSON-schema input) plus one case in executeAction's switch. To add a
// new tool:
//   1. Append a {name, description, input_schema} object to TOOLS below.
//   2. Add a `case 'foo':` to executeAction that calls the matching
//      HabiBot helper or memory method.
//   3. Update sage.js's system prompt only if the tool has non-obvious
//      semantics ("don't use this for X" rules).
//
// Most tools just delegate to HabiBot helpers; a few wrap raw ops via
// bot.send when there's no helper yet. Memory tools are the third
// category: they don't touch the world, they touch mongo.
//
// Out of scope (commented for the next person who reads this):
//   - ATTACK / STUN — sage isn't a combat bot. Giving Claude attack
//     verbs is asking for "the sage assaulted Steve" PRs.
//   - DEPOSIT / WITHDRAW / PAYTO — banking. No use case.
//   - CUSTOMIZE / SPRAY / SEXCHANGE — avatar mutation; one-shot and
//     pretty disruptive.
//   - FNKEY — meta UI, not narratively useful.
//   - RUB / WISH / item-specific magic verbs — re-add when sage
//     actually carries a magic lamp / wand and there's a story reason.

const log = require('winston')
const awareness = require('./awareness')
const { sanitizeForC64 } = require('./petscii')
const { ACTION_DO, ACTION_GET, ACTION_GO, ACTION_PUT, ACTION_TALK } = require('../../../habiworld').constants

const TOOLS = [
  // ── movement / navigation ────────────────────────────────────────
  {
    name: 'walk_to_exit',
    description: 'Walk to a region exit and transit to the adjacent region. Use only when someone explicitly asks you to leave or follow them. The scene\'s Exits line shows SCREEN(COMPASS)→ref — always pass the SCREEN direction (UP/RIGHT/DOWN/LEFT). If someone says "go north", look up which screen direction is labeled NORTH and use that.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['UP', 'RIGHT', 'DOWN', 'LEFT'] },
      },
      required: ['direction'],
    },
  },
  {
    name: 'walk_to_avatar',
    description: 'Walk over to a specific avatar in the current region.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The avatar name shown in the scene description.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'walk_to_coords',
    description: 'Walk to specific tile coordinates within the current region. Use only if you have a reason to stand somewhere precise; prefer walk_to_avatar or walk_to_exit when applicable.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'integer', description: '0-255, screen X.' },
        y: { type: 'integer', description: '128-160 typical floor range.' },
        facing: { type: 'integer', enum: [0, 1], description: '0 faces right, 1 faces left.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'walk_to_object',
    description: 'Walk to a specific object in the region using its class\'s GO behavior (same as ' +
      'pointing at the object and pressing GO on the C64). Handles doors (walks to the adjacent ' +
      'standing spot) and all other objects. Use pass_through=true ONLY for an already-open door ' +
      'when you want to walk THROUGH it and enter the region beyond — this requests a region change.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'Noid of the object to walk to.' },
        pass_through: { type: 'boolean', description: 'true to pass through an open door. Default false.' },
      },
      required: ['noid'],
    },
  },
  {
    name: 'talk_to_object',
    description: 'TALK to an object (ACTION_TALK / slot 6 in the class table). SageBot walks adjacent ' +
      'first, then sends the text. Class-specific effects: Teleport — say the destination address ' +
      '(e.g. "HOME", "CENTRAL-1", a custom port code) to teleport there; the booth must be activated ' +
      'first (activate it with do_object after paying with pay_machine). ' +
      'Jukebox — words broadcast to the room. Magic_lamp (genie out) — make a wish. ' +
      'Most other objects — ordinary region broadcast.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'Noid of the object to talk to.' },
        text: { type: 'string', description: 'What to say to the object.' },
      },
      required: ['noid', 'text'],
    },
  },
  {
    name: 'face_direction',
    description: 'Turn your avatar to face LEFT, RIGHT, FORWARD (toward the camera), or BEHIND.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['LEFT', 'RIGHT', 'FORWARD', 'BEHIND'] },
      },
      required: ['direction'],
    },
  },
  {
    name: 'wait',
    description: 'Pause for dramatic effect. Useful before delivering a punchline or when the conversation wants a beat. Max 5 seconds.',
    input_schema: {
      type: 'object',
      properties: {
        seconds: { type: 'number', minimum: 0.5, maximum: 5 },
      },
      required: ['seconds'],
    },
  },

  // ── posture / emote ──────────────────────────────────────────────
  {
    name: 'do_posture',
    description: 'Perform a body posture / emote. Useful for non-verbal acknowledgement (WAVE at someone, JUMP for joy, FROWN at a complaint).',
    input_schema: {
      type: 'object',
      properties: {
        posture: { type: 'string', enum: ['WAVE', 'POINT', 'EXTEND_HAND', 'JUMP', 'BEND_OVER', 'STAND_UP', 'PUNCH', 'FROWN'] },
      },
      required: ['posture'],
    },
  },

  // ── speech ───────────────────────────────────────────────────────
  // Public say is the default channel — Claude doesn't need a tool
  // for it; just emit text and the orchestrator speaks it. Whisper
  // (ESP) IS a tool because it's a deliberate channel choice.
  {
    name: 'whisper',
    description: 'Send a private ESP (telepathic) message to a specific avatar. Invisible to everyone else in the room. Use for asides, confidences, or follow-ups you don\'t want broadcast.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Avatar name to whisper to. Must be present in the region.' },
        text: { type: 'string', description: 'What to whisper. Keep it short (1-2 sentences).' },
      },
      required: ['to', 'text'],
    },
  },

  // ── teleport / social ────────────────────────────────────────────
  // The /i, /j, /ai, /aj commands are NeoHabitat extensions — sent as
  // regular SPEAK lines starting with "/", elko's run_special_command
  // intercepts them. /i invites someone to YOUR location; /j asks to
  // teleport to THEIRS. /ai accepts a pending invite, /aj accepts a
  // pending join request.
  {
    name: 'invite_to_join',
    description: 'Invite another avatar to teleport to your current location. They get a popup prompting them to enter /ai. Use this to bring a friend over.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Avatar name to invite.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'request_join',
    description: 'Ask another avatar if you can teleport to where THEY are. They get a popup prompting them to enter /aj. Use this to visit someone.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Avatar name to join.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'accept_invite',
    description: 'Accept a pending teleport invitation that someone sent you (the prompt mentioned /ai). Teleports you to them.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'accept_join',
    description: 'Accept a pending join request someone sent you (the prompt mentioned /aj). Teleports them to you.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── object manipulation ──────────────────────────────────────────
  {
    name: 'pick_up',
    description: 'GET an item — moves it into your HANDS slot. Works for items on the ground in the ' +
      'room AND for items already in your own pocket (use it to pull a Token, Compass, etc. out of ' +
      'a pocket slot into your HANDS so you can then give_to_avatar). Requires your HANDS to be ' +
      'empty first; if you\'re already holding something, put_down or give it away before picking ' +
      'up something new.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The Habitat object ref shown in the scene description (or in your inventory).' },
        noid: { type: 'integer', description: 'The noid shown alongside the ref.' },
      },
      required: ['ref', 'noid'],
    },
  },
  {
    name: 'put_down',
    description: 'PUT — place the item you are CURRENTLY HOLDING (HANDS slot) onto the floor or into an ' +
      'open container. Habitat\'s PUT only works on the in-HANDS item; if the item you want to drop is ' +
      'in a numbered pocket slot, you MUST pick_up(ref, noid) FIRST to move it into HANDS, then ' +
      'put_down. The "In your pockets" section of the scene shows which item (if any) is [IN HANDS] ' +
      'vs which are [pocket slot N]. Use container_noid=0 for the floor.\n\n' +
      'If you call this with an item that\'s still in a pocket slot, the tool will return an error — ' +
      'do NOT claim to have put the item down in that case. Either pick_up first, or tell the user ' +
      'you can\'t.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the item to put down. Must currently be in your HANDS slot.' },
        container_noid: { type: 'integer', description: '0 to drop on the floor; otherwise the noid of an open container.' },
        x: { type: 'integer', description: 'Target X (0-255). Ignored when dropping into a container.' },
        y: { type: 'integer', description: 'Target Y. Ignored for containers.' },
        orientation: { type: 'integer', description: 'Item orientation byte. 0 is fine for most cases.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'give_to_avatar',
    description: 'Hand whatever is currently in your HANDS slot to another avatar. The full give-something ' +
      'recipe is: (1) pick_up the pocket item you want to give — this moves it from its pocket slot ' +
      'into your HANDS; (2) give_to_avatar(recipient_noid=NN) — transfers your HANDS contents to ' +
      'them. The recipient must also be empty-handed. Habitat\'s wire protocol has no "give specific ' +
      'item" — whatever is in your HANDS is what gets given. NOTE: for paying MONEY (Tokens), use ' +
      'pay_to_avatar instead — it transfers a specific amount and leaves your remaining balance in ' +
      'your pocket, with no pickup dance.',
    input_schema: {
      type: 'object',
      properties: {
        recipient_noid: { type: 'integer', description: 'Noid of the recipient avatar (must be present, empty-handed).' },
      },
      required: ['recipient_noid'],
    },
  },
  {
    name: 'pay_to_avatar',
    description: 'Pay a specific amount of tokens (money) to another avatar. Subtracts from your Tokens ' +
      'stack and creates a new Tokens stack of `amount` in the recipient\'s HANDS. Use this when ' +
      'someone asks for money or when you want to gift currency. Recipient must be empty-handed. ' +
      'The amount must be greater than 0 and strictly less than your current Tokens balance ' +
      '(emptying the stack entirely uses the give_to_avatar flow instead).',
    input_schema: {
      type: 'object',
      properties: {
        recipient_noid: { type: 'integer', description: 'Noid of the recipient avatar (must be present, empty-handed).' },
        amount: { type: 'integer', description: 'How many tokens to pay (1 to 65535).' },
      },
      required: ['recipient_noid', 'amount'],
    },
  },
  {
    name: 'touch_avatar',
    description: 'Reach out and touch another avatar. A friendly contact gesture.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'Noid of the target avatar.' },
      },
      required: ['noid'],
    },
  },

  // ── containers / doors ───────────────────────────────────────────
  {
    name: 'open',
    description: 'Open a door, box, bag, chest, or other openable container in the room. SageBot will walk adjacent to it first.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'Noid of the object to open, as shown in the scene.' },
      },
      required: ['noid'],
    },
  },
  {
    name: 'close',
    description: 'Close a door, box, bag, chest, or other openable container. SageBot will walk adjacent to it first.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'Noid of the object to close, as shown in the scene.' },
      },
      required: ['noid'],
    },
  },

  // ── the universal DO verb ────────────────────────────────────────
  {
    name: 'do_object',
    description: 'Operate an object the way the original Habitat DO verb did — each kind of object ' +
      'responds in its own way: a held Flashlight toggles, a Jukebox shows its next catalog page, a ' +
      'Vendo machine cycles its display window, a Box/Bag/Chest opens or closes (walk up first happens ' +
      'automatically), a Garbage_can flushes, held Drugs take a dose, a held Windup_toy winds, a held ' +
      'Magic_lamp summons the genie, a held Paper/Book reads. SageBot walks to the object when the ' +
      'verb requires it. Prefer the specific tools (open, pick_up...) when one exists; use this for ' +
      'everything else.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer', description: 'Noid of the object, as shown in the scene.' },
        amount: { type: 'integer', description: 'Token amount, for money interactions.' },
        text: { type: 'string', description: 'Words, for objects that take them.' },
      },
      required: ['noid'],
    },
  },

  // ── avatar state ─────────────────────────────────────────────────
  {
    name: 'sit_down',
    description: 'Sit on a chair, couch, bench, bed, or hot tub in the room. SageBot walks to it first.',
    input_schema: {
      type: 'object',
      properties: {
        noid: { type: 'integer' },
      },
      required: ['noid'],
    },
  },
  {
    name: 'stand_up',
    description: 'Stand up if currently seated.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'discorporate',
    description: 'Turn into a Ghost — invisible to most interactions. Use when you want to observe quietly without participating.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── memory ───────────────────────────────────────────────────────
  {
    name: 'recall',
    description: 'Search your long-term memory for past conversations or notes. Use when someone references something you should remember but the immediate context does not have it.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search across past conversations and notes.' },
        avatar: { type: 'string', description: 'Optional: limit to one specific person.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember',
    description: 'Save a durable note about someone or something. Use sparingly — for facts that matter beyond the current conversation (someone\'s job, a promise made, a recurring topic). Do NOT use for routine chit-chat.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Who or what the note is about (an avatar name, an object name, a region name).' },
        fact: { type: 'string', description: 'The fact to remember, in your own words.' },
      },
      required: ['subject', 'fact'],
    },
  },
  {
    name: 'remember_procedure',
    description: 'Record a reusable HOW-TO lesson about operating in the world, tied to a place or a kind of object (NOT a person). Use when you work out how to do something that was not obvious — e.g. "to mail a letter, write_paper with a \'to:\' first line then send_mail", or "this door must be opened before you can walk through it". This is your procedural memory and is auto-surfaced whenever you are somewhere it applies. Different from remember, which stores facts about PEOPLE.',
    input_schema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'The region name or object TYPE this how-to applies to (e.g. "Door", "Magic_lamp", "Fountain"). Use the object type as shown in the scene, not a specific ref.' },
        lesson: { type: 'string', description: 'The reusable procedure, in your own words.' },
      },
      required: ['context', 'lesson'],
    },
  },
  {
    name: 'list_inventory',
    description: 'Look in your own pockets and list what you are carrying, plus your bank balance. ' +
      'Use this before claiming you have or don\'t have an item or money. Each item shows a `location`: ' +
      '"HANDS (currently held)" is the one item in your hand; "pocket slot N" items are STORED and must be ' +
      'picked up into HANDS before use; "mail-slot" is your mailbox. `hands` says what (if anything) you hold. ' +
      '`bank_balance` is account money (ATM/bank only); to pay a vending machine you must be HOLDING a Tokens item.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── inter-avatar item transfer ───────────────────────────────────
  {
    name: 'grab_from_avatar',
    description: 'Take whatever another avatar is currently holding (their HANDS item) into your own HANDS. ' +
      'Your HANDS must be empty AND they must be holding something AND the region must allow theft ' +
      '(some zones are theft-free). Counterpart to give_to_avatar.',
    input_schema: {
      type: 'object',
      properties: {
        giver_noid: { type: 'integer', description: 'Noid of the avatar you are taking from.' },
      },
      required: ['giver_noid'],
    },
  },

  // ── world queries ────────────────────────────────────────────────
  {
    name: 'user_list',
    description: 'Ask elko for the global online-user list. The reply arrives as a private message ' +
      'with names of everyone connected — useful when someone asks "who else is on?".',
    input_schema: { type: 'object', properties: {} },
  },

  // ── generic item interaction ─────────────────────────────────────
  {
    name: 'read',
    description: 'READ a Book, Paper, or Plaque. page=0 advances to the next page; positive jumps ' +
      'directly. The page contents come back as private speech you can quote or summarize.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        page: { type: 'integer', description: '0 to advance, 1..N to jump directly.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'write_paper',
    description: 'WRITE on a Paper currently in your HANDS. Replaces the existing contents. Pass an ' +
      'empty string to clear the paper.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the Paper (must be in your HANDS).' },
        text: { type: 'string', description: 'New paper contents — plain ASCII only.' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'mail_paper',
    description: 'PSENDMAIL — drop a written Paper into the mail system to deliver to the recipient ' +
      'whose name is encoded on the paper itself.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the Paper to mail.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'compose_and_send_mail',
    description: 'One-shot mail composer: takes care of finding a blank Paper, getting it into HANDS, ' +
      'writing "to: <recipient>\\n<body>" on it, and PSENDMAILing it. Use this instead of the ' +
      'three-step pick_up + write_paper + mail_paper dance — the "to:" first line is mandatory ' +
      'and easy to forget. Recipient is auto-lowercased to match elko\'s MailQueue lookup.',
    input_schema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Avatar name to mail (case-insensitive).' },
        body: { type: 'string', description: 'Letter body. Plain ASCII only; the C64 client mangles UTF-8.' },
      },
      required: ['recipient', 'body'],
    },
  },
  {
    name: 'ask_object',
    description: 'ASK an oracle object — a Crystal_ball, Fountain, or Bureaucrat. Returns a private ' +
      'reply you can quote. Crystal balls answer yes/no fortune-style; the Fountain responds to ' +
      'free-form questions; Bureaucrats have a fixed FAQ.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        text: { type: 'string', description: 'The question to ask.' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'throw_object',
    description: 'THROW the item you are holding across the region. target_noid=0 means "just land at ' +
      'x,y on the floor"; a non-zero noid throws at that avatar. Must currently be in your HANDS.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the item you are throwing.' },
        target_noid: { type: 'integer', description: '0 to throw to coords, otherwise the noid to throw at.' },
        x: { type: 'integer' },
        y: { type: 'integer' },
      },
      required: ['ref'],
    },
  },

  // ── devices (ON/OFF) ─────────────────────────────────────────────
  {
    name: 'toggle_device',
    description: 'Switch a Flashlight, Floor_lamp, or Movie_camera on or off. Lighting changes affect ' +
      'the region brightness; Movie_camera toggle starts/stops recording.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        on: { type: 'boolean', description: 'true = ON, false = OFF.' },
      },
      required: ['ref', 'on'],
    },
  },

  // ── apparel ──────────────────────────────────────────────────────
  {
    name: 'wear_item',
    description: 'WEAR a Head or Ring you are holding — moves it from HANDS to the corresponding worn ' +
      'slot. Your appearance updates for everyone in the region.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the item to wear (must be in your HANDS).' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'remove_item',
    description: 'REMOVE a worn Head or Ring back into HANDS. Reverse of wear_item.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the worn item to remove.' },
      },
      required: ['ref'],
    },
  },

  // ── toys / games ─────────────────────────────────────────────────
  {
    name: 'wind_toy',
    description: 'WIND a Windup_toy — it springs into action briefly. Pure flavor / silly fun.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'roll_die',
    description: 'ROLL a Die. Result is broadcast to the region.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'king_piece',
    description: 'KING a Game_piece — toggles a checker between regular and king-piece state. Only ' +
      'meaningful during a board game.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },

  // ── magic ────────────────────────────────────────────────────────
  {
    name: 'rub_lamp',
    description: 'RUB a Magic_lamp to summon its genie. Once genied, use wish_on_lamp to make a wish. ' +
      'Lamps are rare and can\'t be given away once a genie is out.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'wish_on_lamp',
    description: 'WISH on a Magic_lamp whose genie is already out (from a prior rub_lamp). The text ' +
      'is the wish itself — Habitat has a fixed grammar of wishes, see Magic_lamp.java for what ' +
      'actually parses; freeform text is mostly comedic.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        text: { type: 'string', description: 'The wish to make.' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'use_magic',
    description: 'MAGIC — generic magic verb for Magic_wand, Magic_staff, Amulet, Gemstone, ' +
      'Knick_knack, Ring, etc. Each item-class implements its own effect; target_noid is the noid ' +
      'the magic is aimed at (0 if self / no target). Read the item\'s description before guessing ' +
      'what the magic does.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        target_noid: { type: 'integer', description: '0 for self / no target, otherwise the target avatar/item noid.' },
      },
      required: ['ref'],
    },
  },

  // ── misc world objects ───────────────────────────────────────────
  {
    name: 'direct_compass',
    description: 'DIRECT — ask a Compass which way is which. Reply names the cardinal directions ' +
      'available from this region.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'spray_can',
    description: 'SPRAY paint a body part using a Spray_can in HANDS. Limb codes: ' +
      '0=LEGS, 1=TORSO (default if omitted), 2=ARMS, 3=FACE (only works if wearing a Head). ' +
      'To paint all parts, call once per limb. Visually changes your avatar.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        limb: { type: 'integer', description: '0=LEGS, 1=TORSO, 2=ARMS, 3=FACE.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'fill_bottle',
    description: 'FILL an empty Bottle (must be holding it; presumably at a fountain or spring).',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'pour_bottle',
    description: 'POUR out a filled Bottle. Counterpart to fill_bottle.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'dig_shovel',
    description: 'DIG with a Shovel you are holding. Reveals buried items at your current location ' +
      'if any are there. Mostly used in scavenger hunts.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'feed_aquarium',
    description: 'FEED the fish in an Aquarium. Drops the in-HANDS item into the tank (usually food).',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'flush_garbage',
    description: 'FLUSH a Garbage_can — empties whatever has been dropped in. Use sparingly: this is ' +
      'irreversible from your end (though the made\'s daily script may recycle).',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'take_drug',
    description: 'TAKE — consume a Drug item you are holding. Effects vary by drug; some are ' +
      'non-ideal. Use in character only.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'scan_sensor',
    description: 'SCAN — point a Sensor at the region for a description of what\'s here.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'zap_to_port',
    description: 'ZAPTO — use a Teleport booth to jump to a destination. ' +
      'port_number is the destination address string (like a phone number — e.g. "HOME", "DOWNTOWN"). ' +
      'Prefer talk_to_object instead: stand in the booth with walk_to_object, then talk_to_object with the address.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        port_number: { type: 'string', description: 'Destination address string (e.g. "HOME", "DOWNTOWN").' },
      },
      required: ['ref'],
    },
  },

  // ── dangerous / one-shot ─────────────────────────────────────────
  {
    name: 'stun_avatar',
    description: 'STUN another avatar using a Stun_gun in HANDS. Target is immobilized for several ' +
      'seconds. Use only in character — this is hostile behavior; most regions frown on it.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the Stun_gun in your HANDS.' },
        target_noid: { type: 'integer', description: 'Noid of the avatar to stun.' },
      },
      required: ['ref', 'target_noid'],
    },
  },
  {
    name: 'pull_grenade_pin',
    description: 'PULLPIN on a Grenade — starts the countdown. Goes off shortly after; throw it away ' +
      'first via throw_object unless you want the explosion at your feet. Theatrically dangerous.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'fake_shoot',
    description: 'FAKESHOOT — fire a Fake_gun (the gag gun) held in HANDS. Makes a loud noise and a ' +
      'BANG flag; no real damage. Single shot, then reset_fake_gun before firing again. ' +
      'ONLY works on a Fake_gun — a real Gun ignores this silently; use attack for a real Gun.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'attack',
    description: 'ATTACK — fire a REAL weapon (a Gun, etc.) held in HANDS at a target avatar. This is ' +
      'the actual Habitat combat verb and can damage or kill the target. Use strictly in character ' +
      'and only when clearly invited (a demo, a duel) — most regions are weapons-free zones where the ' +
      'weapon simply will not operate. Returns whether the shot landed and the damage result. ' +
      'For the harmless gag gun use fake_shoot instead.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the real weapon in your HANDS.' },
        target_noid: { type: 'integer', description: 'Noid of the avatar to attack.' },
      },
      required: ['ref', 'target_noid'],
    },
  },
  {
    name: 'reset_fake_gun',
    description: 'RESET a spent Fake_gun back to ready state.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'bug_out',
    description: 'BUGOUT — emergency-teleport home using an Escape_device. Use only when you actually ' +
      'need to leave the region in a hurry; sends you to your turf.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'sex_change',
    description: 'SEXCHANGE — toggle avatar body type via a Sex_changer device. Affects your ' +
      'appearance permanently (until used again).',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },

  // ── commerce ─────────────────────────────────────────────────────
  {
    name: 'deposit_to_atm',
    description: 'DEPOSIT — feed a Tokens stack from your pocket into an Atm. The Atm consumes the ' +
      'Tokens item and credits your bank balance.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the Atm.' },
        token_noid: { type: 'integer', description: 'Noid of YOUR Tokens stack to deposit.' },
      },
      required: ['ref', 'token_noid'],
    },
  },
  {
    name: 'withdraw_from_atm',
    description: 'WITHDRAW — Atm spawns a fresh Tokens stack of `amount` in your HANDS. Your HANDS ' +
      'must be empty; bank balance must cover the amount.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the Atm.' },
        amount: { type: 'integer', description: 'How many tokens to withdraw (1 to 65535).' },
      },
      required: ['ref', 'amount'],
    },
  },
  {
    name: 'pay_machine',
    description: 'PAY a Coke_machine, Fortune_machine, or Teleport. The fixed price is paid with a TOKENS ' +
      'item you are HOLDING IN HANDS — NOT your bank balance, and NOT pocket-stored tokens. If your hands ' +
      'are empty (or not holding enough tokens) it fails with "not enough money"; pick_up a Tokens item ' +
      'first. Returns amount_charged. WARNING: paying does NOT mean you received anything — a Coke_machine ' +
      '(the "Choke") charges you and dispenses NOTHING as a gag. Never claim you got an item from a machine ' +
      'without confirming it via list_inventory.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'vend_item',
    description: 'VEND — buy the currently-displayed item from a Vendo_front. Cost is deducted from ' +
      'your pocket Tokens; the item appears in your region next to the vendo.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'vendo_select',
    description: 'VSELECT — cycle the Vendo_front\'s display to the next item available. Use before ' +
      'vend_item if the visible item isn\'t the one you want.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'munch_pawn',
    description: 'MUNCH — Pawn_machine consumes the item in your HANDS and credits your bank balance ' +
      'based on the item\'s value. One-way: the item is gone.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
  },
  {
    name: 'send_mail',
    description: 'SENDMAIL — drop the in-HANDS Paper into a Dropbox for delivery. Recipient is ' +
      'encoded on the paper (you wrote it there via write_paper).',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the Dropbox.' },
      },
      required: ['ref'],
    },
  },
]

// HabiBot helpers / raw ops can hang if elko is slow or the message is
// dropped; wrap each await in a per-tool timeout so a stuck tool can't
// pin sage's event loop forever. Returns null on timeout/failure — the
// calling layer turns that into a tool_result for Claude's next turn.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// PUT op (put_down). HabiBot has bot.putObj(objRef, containerNoid, x, y, orientation),
// but wrap it here for symmetry with the others and to give a clear log line.
function putDown(bot, ref, containerNoid, x, y, orientation) {
  return bot.putObj(ref, containerNoid || 0, x || 80, y || 144, orientation || 0)
}

// GET op (used by the compose_and_send_mail flow; pick_up goes through
// bot.performAction('GET') which adds the goToAndGet choreography).
// Elko's GET takes no parameters beyond `to` — the old containerNoid
// field drew an "ignored unknown parameter" warning on every send.
function getObj(bot, ref) {
  return bot.send({ op: 'GET', to: ref })
}

// ESP whisper to a specific avatar. Elko's ESP model: SPEAK with
// `text:"to:NAME"` (esp=0) sets ESPTargetName for this session
// (Avatar.SPEAK at line 669-680 of Avatar.java). After that, op:ESP
// messages route to that target. For an LLM-driven bot we want
// explicit per-call targeting, so we pair every whisper with the
// targeting prefix — even though it's redundant when whispering to
// the same person twice in a row, it eliminates "whoops, I just
// whispered something private to the wrong person" failure modes
// after Claude switches conversation partners.
//
// Both writes go through sanitizeForC64 so smart quotes / em-dashes /
// emoji from Claude get folded to PETSCII-safe ASCII before hitting
// the wire (otherwise the C64 client renders the multi-byte UTF-8 as
// garbage block glyphs — observed: "Sounds good — be right over."
// landed as "Sounds good |Ƒ‰| be right over.").
async function whisperTo(bot, to, text) {
  if (!to) {
    throw new Error('whisper target is required')
  }
  const safeTo = sanitizeForC64(to)
  const safeText = sanitizeForC64(text || '')
  await bot.say(`to:${safeTo}`)
  await bot.ESPsay(safeText)
}

// /i, /j, /ai, /aj — special commands sent as plain SPEAK lines starting
// with "/". Elko's Avatar.SPEAK detects the prefix and routes to
// run_special_command (Avatar.java line 667). The `say()` helper sends
// SPEAK with esp=0, which is the only mode that triggers the special
// path; sending these via ESPsay would just whisper the literal text.
function specialCommand(bot, line) {
  return bot.say(line)
}

// executeAction: run the tool the model asked for and return a JSON-able
// result for the next turn. The result shape mirrors what's useful to
// Claude — { ok: true } for void ops, an items array for list_inventory,
// recall hits for recall, etc. A throw becomes { ok: false, error: ... }
// so Claude can see why a tool failed and adapt instead of plowing ahead.
async function executeAction(toolUse, bot, ctx) {
  const { name, input } = toolUse
  const args = input || {}
  const mem = ctx && ctx.mem
  const botName = (bot.config && bot.config.username) || 'SageBot'
  log.info('Tool: %s(%s)', name, JSON.stringify(args))
  try {
    switch (name) {
      // ── movement ────────────────────────────────────────────────
      case 'walk_to_exit':
        await withTimeout(bot.walkToExit(args.direction), 30_000, 'walkToExit')
        return { ok: true }
      case 'walk_to_avatar': {
        const target = findAvatarByName(bot, args.name)
        if (!target) return { ok: false, error: `no avatar named ${args.name} present` }
        // 30s, not 15: walkToAvatar → walkTo → sendWithDelay(10s), and the
        // 10s delay sits inside the action queue. If a previous op (greeting
        // POSTURE, etc.) is still in flight, the WALK doesn't even start
        // counting until that completes — easily blowing a 15s budget.
        await withTimeout(bot.walkToAvatar(target), 30_000, 'walkToAvatar')
        return { ok: true }
      }
      case 'walk_to_coords':
        await withTimeout(bot.walkTo(args.x, args.y, args.facing || 0), 30_000, 'walkTo')
        return { ok: true }
      case 'walk_to_object': {
        const walked = await withTimeout(
          bot.performVerb(ACTION_GO, args.noid, args.pass_through ? { passThrough: true } : {}),
          30_000, 'walk_to_object')
        return walked.ok ? { ok: true } : { ok: false, error: walked.reason }
      }
      case 'talk_to_object': {
        // Walk adjacent first (GO), then TALK — matches the teleport flow
        // where adjacency is required before ZAPTO routes through.
        const go = await withTimeout(
          bot.performVerb(ACTION_GO, args.noid),
          30_000, 'talk_to_object.walk')
        if (!go.ok) return { ok: false, error: `could not walk to object: ${go.reason}` }
        const talked = await withTimeout(
          bot.performVerb(ACTION_TALK, args.noid, { text: args.text || '' }),
          15_000, 'talk_to_object.talk')
        return talked.ok ? { ok: true } : { ok: false, error: talked.reason }
      }
      case 'face_direction':
        await withTimeout(bot.faceDirection(args.direction), 5_000, 'faceDirection')
        return { ok: true }
      case 'wait':
        await bot.wait(Math.min(5, Math.max(0.5, args.seconds || 1)) * 1000)
        return { ok: true }

      // ── posture ─────────────────────────────────────────────────
      case 'do_posture':
        await withTimeout(bot.doPosture(args.posture), 5_000, 'doPosture')
        return { ok: true }

      // ── speech ──────────────────────────────────────────────────
      case 'whisper':
        await whisperTo(bot, args.to, args.text || '')
        return { ok: true }

      // ── teleport / social commands ──────────────────────────────
      case 'invite_to_join':
        if (!args.name) return { ok: false, error: 'name required' }
        await specialCommand(bot, `/i ${args.name}`)
        return { ok: true }
      case 'request_join':
        if (!args.name) return { ok: false, error: 'name required' }
        await specialCommand(bot, `/j ${args.name}`)
        return { ok: true }
      case 'accept_invite':
        await specialCommand(bot, '/ai')
        return { ok: true }
      case 'accept_join':
        await specialCommand(bot, '/aj')
        return { ok: true }

      // ── object manipulation ─────────────────────────────────────
      case 'pick_up': {
        // habiworld GET recipe (generic_goToAndGet.m): hands-empty
        // precondition, walk to the item, send GET, and apply the
        // pickup to the world model on the success reply — awareness
        // reflects the item in HANDS immediately.
        const got = await withTimeout(bot.performVerb(ACTION_GET, args.noid), 20_000, 'pick_up')
        if (!got.ok) {
          const why = {
            'hands-full': 'your HANDS are full — put_down or give away the held item first',
            'no-such-object': `no object with noid ${args.noid} in this region`,
            'server-denied': 'the server refused the GET (fixed in place, out of reach, or held by someone else)',
            'not-in-region': 'not in a region yet',
          }[got.reason] || got.reason
          return { ok: false, error: why }
        }
        return { ok: true }
      }
      case 'put_down': {
        // habiworld PUT recipe (generic_goToAndDropAt.m): the recipe
        // itself enforces the in-HANDS precondition from the world
        // model, walks to the drop spot, and applies the drop on the
        // success reply. We keep two Claude-facing guards: a ref
        // sanity check (PUT drops whatever is in HANDS, so refuse if
        // that isn't the item Claude named) and the explicit
        // pocket-slot hint when nothing is held.
        const held = bot.world && bot.world.me && bot.world.holding(bot.world.me.noid)
        if (held && args.ref && held.ref !== args.ref) {
          return {
            ok: false,
            error: `you are holding ${held.ref}, not ${args.ref} — PUT drops whatever is in HANDS`,
          }
        }
        if (!held) {
          const inv = awareness.getInventory(bot)
          const item = inv.find((it) => it.ref === args.ref)
          if (!item) {
            return { ok: false, error: `no item with ref ${args.ref} in your pocket` }
          }
          return {
            ok: false,
            error: `item is in pocket slot ${item.slot}, not HANDS. ` +
              `Call pick_up(ref="${args.ref}", noid=${item.noid}) first to move it into HANDS, ` +
              `then put_down will work. Do NOT tell anyone you put it down — you haven\'t.`,
          }
        }
        // Dispatch ACTION_PUT on the drop target (ground surface or container).
        // The target's PUT slot handles the walk and drop:
        //   ground/street → generic_goToAndDropAt (walk to coords, bend over, drop)
        //   bag/box/chest  → generic_goToAndDropInto (walk to container, drop in)
        const targetNoid = args.container_noid || (() => {
          for (const o of bot.world.objects.values()) {
            if (o.containerRef !== bot.world.region.ref) continue
            if (o.type === 'Street' || o.type === 'Ground') return o.noid
            if ((o.type === 'Flat' || o.type === 'Trapezoid' || o.type === 'Super_trapezoid') &&
                o.mod.flat_type === 2) return o.noid
          }
          return null
        })()
        if (!targetNoid) return { ok: false, error: 'no walkable surface found in region' }
        const put = await withTimeout(
          bot.performVerb(ACTION_PUT, targetNoid, { x: args.x || 80, y: args.y || 144 }),
          20_000, 'put_down')
        if (!put.ok) {
          return { ok: false, error: `server refused the PUT (${put.reason})` }
        }
        return { ok: true }
      }
      case 'give_to_avatar': {
        // habiworld HAND recipe: walks to the recipient first (the
        // goToAnd* pattern) and moves the item out of our HANDS in the
        // world model on the success reply — so sage no longer believes
        // it still holds what it just gave away. item_noid remains
        // informational; the server transfers whatever is in HANDS.
        // avatar_put.m: ACTION_PUT pointed at an avatar = the give gesture.
        const recipient = bot.world.get(args.recipient_noid)
        if (!recipient || recipient.type !== 'Avatar') {
          return { ok: false, error: `no avatar with noid ${args.recipient_noid} here` }
        }
        const gave = await withTimeout(
          bot.performVerb(ACTION_PUT, args.recipient_noid), 20_000, 'give_to_avatar')
        if (!gave.ok) {
          const why = {
            'hands-empty': 'your HANDS are empty — pick_up the item first, then give it',
            'server-denied': 'the server refused the HAND (recipient busy or out of reach)',
          }[gave.reason] || gave.reason
          return { ok: false, error: why }
        }
        return { ok: true }
      }
      case 'pay_to_avatar': {
        // Find sage's Tokens item; PAYTO is sent ON the Tokens object.
        const inv = awareness.getInventory(bot)
        const tokens = inv.find((it) => it.type === 'Tokens')
        if (!tokens) return { ok: false, error: 'no Tokens item in your pocket' }
        const amount = parseInt(args.amount, 10)
        if (!Number.isFinite(amount) || amount <= 0 || amount > 65535) {
          return { ok: false, error: 'amount must be a positive integer ≤ 65535' }
        }
        const amount_lo = amount & 0xff
        const amount_hi = (amount >> 8) & 0xff
        await withTimeout(bot.send({
          op: 'PAYTO',
          to: tokens.ref,
          target_id: args.recipient_noid,
          amount_lo,
          amount_hi,
        }), 10_000, 'pay_to_avatar')
        return { ok: true, paid: amount }
      }
      case 'touch_avatar':
        await withTimeout(bot.touchAvatar(args.noid), 10_000, 'touch_avatar')
        return { ok: true }

      // ── containers ──────────────────────────────────────────────
      // DO on a door/container dispatches generic_adjacentOpenClose which
      // walks adjacent, waits for the animation, then sends OPEN/CLOSE.
      case 'open':
      case 'close': {
        // Container/door DO toggles (generic_adjacentOpenClose*) do NOT
        // walk — they punt to depends() when not adjacent, so the OPEN
        // never reaches the wire and looks like a silent refusal. Walk
        // adjacent first (GO), then fire the DO toggle. Matches the C64
        // GO-then-DO sequence and talk_to_object's pattern.
        const go = await withTimeout(bot.performVerb(ACTION_GO, args.noid), 30_000, `${name}.walk`)
        if (!go.ok) return { ok: false, error: `could not walk to it: ${go.reason}` }
        const toggled = await withTimeout(bot.performVerb(ACTION_DO, args.noid), 30_000, name)
        return toggled.ok ? { ok: true } : { ok: false, error: toggled.reason }
      }

      // ── avatar state ────────────────────────────────────────────
      // GO at furniture is the C64's sit/stand toggle
      // (generic_goToFurniture): walks over, SITORSTAND, tracks the
      // avatar's container so the world model knows we're seated.
      case 'sit_down': {
        const sat = await withTimeout(
          bot.performVerb(ACTION_GO, args.noid), 30_000, 'sit_down')
        return sat.ok ? { ok: true, posture: sat.posture } : { ok: false, error: sat.reason }
      }
      case 'stand_up': {
        const me = bot.world.me
        const seat = me && me.containerRef && me.containerRef !== bot.world.region.ref
          ? bot.world.getByRef(me.containerRef) : null
        if (!seat) return { ok: false, error: 'not-seated' }
        const stood = await withTimeout(
          bot.performVerb(ACTION_GO, seat.noid), 30_000, 'stand_up')
        return stood.ok ? { ok: true } : { ok: false, error: stood.reason }
      }
      case 'do_object': {
        const done = await withTimeout(
          bot.performVerb(ACTION_DO, args.noid, {
            amount: args.amount, text: args.text,
          }), 30_000, 'do_object')
        // Pass through whatever the behavior surfaced (read text, key
        // numbers, catalog pages, detected flags...).
        return done.ok ? done : { ok: false, error: done.reason }
      }
      case 'discorporate':
        await withTimeout(bot.discorporate(), 10_000, 'discorporate')
        return { ok: true }

      // ── memory ──────────────────────────────────────────────────
      case 'recall': {
        if (!mem) return { ok: false, error: 'memory not configured' }
        const hits = await mem.recall({ bot: botName, query: args.query, avatar: args.avatar, limit: 5 })
        // Trim each row to fields Claude will actually use — full mongo
        // _ids and ts objects are noise.
        return {
          ok: true,
          conversations: (hits.conversations || []).map((r) => ({
            avatar: r.avatar, direction: r.direction, text: r.text, ts: r.ts,
          })),
          notes: (hits.notes || []).map((r) => ({
            subject: r.subject, fact: r.fact, ts: r.ts,
          })),
        }
      }
      case 'remember': {
        if (!mem) return { ok: false, error: 'memory not configured' }
        await mem.remember({ bot: botName, subject: args.subject, fact: args.fact })
        return { ok: true }
      }
      case 'remember_procedure': {
        if (!mem) return { ok: false, error: 'memory not configured' }
        await mem.rememberProcedure({ bot: botName, context: args.context, lesson: args.lesson, outcome: 'observation' })
        return { ok: true }
      }
      case 'list_inventory':
        return { ok: true, ...awareness.inventorySummary(bot) }

      // ── inter-avatar item transfer ──────────────────────────────
      case 'grab_from_avatar':
        await withTimeout(bot.grabFromAvatar(args.giver_noid), 10_000, 'grab_from_avatar')
        return { ok: true }

      // ── world queries ───────────────────────────────────────────
      case 'user_list':
        await withTimeout(bot.userList(), 10_000, 'user_list')
        return { ok: true }

      // ── generic item interaction ────────────────────────────────
      case 'read':
        await withTimeout(bot.readObject(args.ref, args.page), 10_000, 'read')
        return { ok: true }
      case 'write_paper':
        await withTimeout(bot.writePaper(args.ref, args.text || ''), 10_000, 'write_paper')
        return { ok: true }
      case 'mail_paper':
        await withTimeout(bot.mailPaper(args.ref), 10_000, 'mail_paper')
        return { ok: true }
      case 'compose_and_send_mail': {
        // The "to: <name>" first line is mandatory and easy for Claude to
        // forget — bundling pick_up + write + mail into a single tool
        // eliminates the failure mode where sage writes a body but no
        // address line, the PSENDMAIL gets rejected, and sage doesn't
        // notice because the dispatch returned ok:true at TCP-write
        // time.
        //
        // Source-of-blank-paper preference order:
        //   1. blank Paper already in HANDS — write + mail in place.
        //   2. blank Paper in a numbered pocket slot — pick_up first.
        //   3. blank Paper in MAIL_SLOT — pick_up; elko auto-spawns a
        //      fresh blank Paper in MAIL_SLOT (Paper.GET special-case).
        //   4. unread LETTER in MAIL_SLOT — refuse with a clear error,
        //      because picking it up would dismiss unread mail.
        //   5. no blank paper anywhere — refuse.
        const recipient = String(args.recipient || '').trim().toLowerCase()
        const body = String(args.body || '')
        if (!recipient) return { ok: false, error: 'recipient is required' }
        if (!/^[a-z0-9._-]{1,20}$/.test(recipient)) {
          return { ok: false, error: `recipient "${recipient}" doesn't look like an avatar name` }
        }
        const inv = awareness.getInventory(bot)
        const papers = inv.filter((it) => it.type === 'Paper')
        if (!papers.length) return { ok: false, error: 'you have no Paper in your pocket' }
        // Categorize by current paper state. grState=0 BLANK, =2 LETTER.
        const isBlank = (p) => (p.grState || 0) === awareness.PAPER_BLANK_STATE
        let chosen =
          papers.find((p) => p.slot === awareness.HANDS_SLOT && isBlank(p)) ||
          papers.find((p) => p.slot !== awareness.MAIL_SLOT && p.slot !== awareness.HANDS_SLOT && isBlank(p)) ||
          papers.find((p) => p.slot === awareness.MAIL_SLOT && isBlank(p))
        if (!chosen) {
          // The only remaining papers are LETTER state — would lose mail.
          return {
            ok: false,
            error:
              'all pocket Paper is in LETTER state (unread mail). READ it first, then a blank ' +
              'paper will be available for composing.',
          }
        }
        if (chosen.slot !== awareness.HANDS_SLOT) {
          await withTimeout(getObj(bot, chosen.ref), 10_000, 'compose_and_send_mail.pick_up')
        }
        const text = `to: ${recipient}\n${body}`
        await withTimeout(bot.writePaper(chosen.ref, text), 10_000, 'compose_and_send_mail.write')
        await withTimeout(bot.mailPaper(chosen.ref), 10_000, 'compose_and_send_mail.send')
        return { ok: true, recipient }
      }
      case 'ask_object':
        await withTimeout(bot.askObject(args.ref, args.text || ''), 10_000, 'ask_object')
        return { ok: true }
      case 'throw_object': {
        const thrown = await withTimeout(
          bot.performAction('THROW', { noid: args.target_noid || 0, x: args.x, y: args.y }),
          20_000, 'throw_object')
        return thrown.ok ? { ok: true } : { ok: false, error: thrown.reason }
      }

      // ── devices ─────────────────────────────────────────────────
      // The C64 DO is a toggle; the tool promises on/off semantics, so
      // check the tracked state first and only dispatch when it needs
      // flipping. (Falls back to the legacy raw sends when the device
      // isn't in the world model.)
      case 'toggle_device': {
        const dev = bot.world.getByRef(args.ref)
        if (!dev) {
          await withTimeout(
            args.on ? bot.deviceOn(args.ref) : bot.deviceOff(args.ref),
            10_000, 'toggle_device')
          return { ok: true }
        }
        const isOn = !!(dev.mod.on || 0)
        if (isOn === !!args.on) return { ok: true, note: 'already in that state' }
        const flipped = await withTimeout(
          bot.performVerb(ACTION_DO, dev.noid), 30_000, 'toggle_device')
        return flipped.ok ? { ok: true } : { ok: false, error: flipped.reason }
      }

      // ── apparel ─────────────────────────────────────────────────
      case 'wear_item':
        await withTimeout(bot.wearItem(args.ref), 10_000, 'wear_item')
        return { ok: true }
      case 'remove_item':
        await withTimeout(bot.removeItem(args.ref), 10_000, 'remove_item')
        return { ok: true }

      // ── toys / games ────────────────────────────────────────────
      case 'wind_toy':
        await withTimeout(bot.windToy(args.ref), 10_000, 'wind_toy')
        return { ok: true }
      case 'roll_die': {
        const rolled = await withTimeout(bot.rollDie(args.ref), 10_000, 'roll_die')
        return rolled.ok
          ? { ok: true, value: rolled.value }
          : { ok: false, error: 'die did not report a value' }
      }
      case 'king_piece':
        await withTimeout(bot.kingPiece(args.ref), 10_000, 'king_piece')
        return { ok: true }

      // ── magic ───────────────────────────────────────────────────
      case 'rub_lamp':
        await withTimeout(bot.rubLamp(args.ref), 10_000, 'rub_lamp')
        return { ok: true }
      case 'wish_on_lamp':
        await withTimeout(bot.wishOnLamp(args.ref, args.text || ''), 10_000, 'wish_on_lamp')
        return { ok: true }
      case 'use_magic':
        await withTimeout(bot.useMagic(args.ref, args.target_noid || 0), 10_000, 'use_magic')
        return { ok: true }

      // ── misc world objects ──────────────────────────────────────
      case 'direct_compass': {
        const c = await withTimeout(bot.directCompass(args.ref), 10_000, 'direct_compass')
        // The West Pole lies in the `direction` screen-direction from here.
        return { ok: true, west_pole_direction: c.direction, raw: c.text }
      }
      case 'spray_can': {
        const sprayed = await withTimeout(bot.sprayCan(args.ref, args.limb), 10_000, 'spray_can')
        return sprayed.ok ? { ok: true } : { ok: false, error: sprayed.reason }
      }
      case 'fill_bottle':
        await withTimeout(bot.fillBottle(args.ref), 10_000, 'fill_bottle')
        return { ok: true }
      case 'pour_bottle':
        await withTimeout(bot.pourBottle(args.ref), 10_000, 'pour_bottle')
        return { ok: true }
      case 'dig_shovel':
        await withTimeout(bot.digShovel(args.ref), 10_000, 'dig_shovel')
        return { ok: true }
      case 'feed_aquarium':
        await withTimeout(bot.feedAquarium(args.ref), 10_000, 'feed_aquarium')
        return { ok: true }
      case 'flush_garbage':
        await withTimeout(bot.flushCan(args.ref), 10_000, 'flush_garbage')
        return { ok: true }
      case 'take_drug':
        await withTimeout(bot.takeDrug(args.ref), 10_000, 'take_drug')
        return { ok: true }
      case 'scan_sensor':
        await withTimeout(bot.scanSensor(args.ref), 10_000, 'scan_sensor')
        return { ok: true }
      case 'zap_to_port':
        await withTimeout(bot.zapToPort(args.ref, args.port_number), 10_000, 'zap_to_port')
        return { ok: true }

      // ── dangerous / one-shot ────────────────────────────────────
      case 'stun_avatar':
        await withTimeout(bot.stunAvatar(args.ref, args.target_noid), 10_000, 'stun_avatar')
        return { ok: true }
      case 'pull_grenade_pin': {
        const pulled = await withTimeout(bot.pullGrenadePin(args.ref), 10_000, 'pull_grenade_pin')
        return pulled.ok ? { ok: true } : { ok: false, error: pulled.reason }
      }
      case 'fake_shoot':
        await withTimeout(bot.fakeShoot(args.ref), 10_000, 'fake_shoot')
        return { ok: true }
      case 'attack': {
        const hit = await withTimeout(bot.attack(args.ref, args.target_noid), 10_000, 'attack')
        return hit.ok
          ? { ok: true, result: hit.result }
          : { ok: false, error: 'no effect — missed, out of range, or a weapons-free zone' }
      }
      case 'reset_fake_gun':
        await withTimeout(bot.resetFakeGun(args.ref), 10_000, 'reset_fake_gun')
        return { ok: true }
      case 'bug_out':
        await withTimeout(bot.bugOut(args.ref), 10_000, 'bug_out')
        return { ok: true }
      case 'sex_change':
        await withTimeout(bot.sexChange(args.ref), 10_000, 'sex_change')
        return { ok: true }

      // ── commerce ────────────────────────────────────────────────
      case 'deposit_to_atm':
        await withTimeout(bot.depositToAtm(args.ref, args.token_noid), 10_000, 'deposit_to_atm')
        return { ok: true }
      case 'withdraw_from_atm':
        await withTimeout(bot.withdrawFromAtm(args.ref, args.amount), 10_000, 'withdraw_from_atm')
        return { ok: true }
      case 'pay_machine': {
        const paid = await withTimeout(bot.payMachine(args.ref), 10_000, 'pay_machine')
        if (!paid.ok) return { ok: false, error: paid.reason }
        // Paid != dispensed. Tell the truth: charged this much; check your
        // inventory for whatever (if anything) came out. A Coke/Choke
        // machine charges and dispenses nothing — that's the gag.
        return {
          ok: true,
          amount_charged: paid.amount,
          note: 'Payment was charged to your bank balance. This does NOT mean anything was dispensed — ' +
            'a Coke_machine (Choke) takes your money and gives nothing back. Check list_inventory to see ' +
            'if an item actually appeared before claiming you received one.',
        }
      }
      case 'vend_item':
        await withTimeout(bot.vendItem(args.ref), 10_000, 'vend_item')
        return { ok: true }
      case 'vendo_select':
        await withTimeout(bot.selectVendo(args.ref), 10_000, 'vendo_select')
        return { ok: true }
      case 'munch_pawn':
        await withTimeout(bot.munchPawn(args.ref), 10_000, 'munch_pawn')
        return { ok: true }
      case 'send_mail':
        await withTimeout(bot.sendMail(args.ref), 10_000, 'send_mail')
        return { ok: true }

      default:
        log.warn('Unknown tool: %s', name)
        return { ok: false, error: `unknown tool ${name}` }
    }
  } catch (e) {
    log.warn('Tool %s failed: %s', name, e.message)
    return { ok: false, error: e.message }
  }
}

// Resolve an avatar by name (case-insensitive). HabiBot keeps avatars
// in `bot.avatars` keyed by name, but tools accept whatever case Claude
// produced — typically matching the scene description, but humans (and
// LLMs) get casing wrong sometimes.
function findAvatarByName(bot, name) {
  if (!name) return null
  const want = name.toLowerCase()
  for (const k in bot.avatars) {
    if (k.toLowerCase() === want) return bot.avatars[k]
  }
  return null
}

module.exports = { TOOLS, executeAction }
