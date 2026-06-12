# Behavior Layer Port Plan

Porting the C64 client's complete behavior system into habiworld: every
`Behaviors/*.m` file becomes a JS function of the same name, dispatched
through a class-to-resource table transcribed from `new.mud`. Goal: any
JS client (sagebot today, a native game client later) gets the exact
1986 interaction model by supplying I/O callbacks — the behaviors
themselves are client-agnostic and live here.

Original sources: MADE repo (`~/habitat-orig`), `sources/c64/Behaviors/`.

## 1. How the C64 dispatch works (what we're replicating)

Every class record in `new.mud` carries an ordered `action` list.
`GetAction(class, n)` (Main/database.m:204) indexes it. The index space:

| Slot | Meaning | Source of the number |
|------|---------|----------------------|
| 0–7  | User verbs: DO, reverseDO, GO, STOP, GET, PUT, TALK, DESTROY | `ACTION_*` defines, action_head.i:178–185 |
| 8+   | Host messages and internal chain targets | slot number == host message number (avatar slot 24 = `avatar_THROW` = `THROW$` = 24 in Constants.java); non-avatar classes reuse 8+ for internals (`HEAD_INTERNAL_PUT=8`, `COKE_COINOP=9`, `VENDO_COINOP=10`, `TELEPORT_COINOP=11`) |

Two consequences for habiworld:

1. **`deltas.js` is already the slot-8+ half of the avatar/region tables.**
   The port doesn't replace it — the class table's 8+ slots will point at
   (renamed) delta handlers, unifying the two layers we built separately.
2. **`actions.js` recipes are hand-rolled equivalents of slot 0–7
   generics.** `performAction('GET')` ≈ `generic_goToAndGet`. These get
   refactored into `behaviors/` under their original names; `actions.js`
   becomes a thin compatibility shim (or is deleted once sagebot calls
   `dispatch()` directly).

**The `depends` chain** (depends.m): when a behavior can't apply (e.g. DO
on something while holding an incompatible item), it chains to `depends`,
which re-dispatches as **reverseDO on the in-hand item** (or on the
avatar itself if hands are empty). This is how pointing at an avatar
while holding a gun fires the gun. The dispatcher must support this
re-entry, and `doMyAction` (nested verb dispatch, used by every goToAnd*
recipe to invoke its own GO) is the same mechanism.

## 2. The kernel: macro vocabulary → JS

Behaviors only touch the world through `action_head.i` macros and the
`vectors.m` jump table — a closed set. Each becomes a method on the
behavior context. This is the entire surface (`Behaviors/kernel.js`):

| C64 macro / vector | JS | Notes |
|---|---|---|
| `getProp obj, OFF` / `putProp` / `cmpProp` | `ctx.pointed.mod.x` etc. | direct field access; offsets become mod field names (same mapping as FIDDLE_FIELDS) |
| `getArg` / `putArg` | local variables | scratch zero-page slots; plain `let` |
| `sendMsg noid, MSG_X, n` + `waitWhile reply_wait_bit` | `await ctx.send({op, to})` | our sendForReply; MSG_* numbers become op name strings |
| `sendMsgN` | `ctx.sendNoReply(msg)` | fire-and-forget variant |
| `getResponse OFF` | `reply.<field>` | reply field access by name |
| `doMyAction ACTION_GO` | `await ctx.doAction(ACTION_GO)` | nested dispatch on same pointed object; GO failure auto-beeps (macro does this) |
| `chainTo v_depends` | `return ctx.depends()` | tail call into the rdo fallback chain |
| `chainTo v_beep` / `v_boing` | `return ctx.beep()` / `ctx.boing()` | failure terminators; client callback (sagebot: no-op or log) |
| `waitWhile animation_wait_bit` | `await ctx.animationWait(ms)` | already built, distance-scaled |
| `asyncAnimationWait` | `await ctx.animationWait(1000)` | already built |
| `chore AV_ACT_x` | `ctx.chore(act)` | avatar posture chore; client callback (renderer plays it; sagebot no-ops) |
| `changeContainers x, y, noid` | `world._changeContainers(...)` | already built |
| `v_delete_object` / `v_purge_contents` | `world._deleteByNoid(...)` | already built (incl. cascade) |
| `v_find_goto_coords` | `gotoCoords(world, noid)` | already built (actions.js) |
| `v_adjacency_check` / `v_punt_if_not_adjacent` / `ifNotAdjacentFail` | `ctx.isAdjacent()` / `ctx.puntIfNotAdjacent()` | adjacency_check (Main/actions.m:1209): same x after find_goto_coords, y within mask |
| `v_get_object_walk_xy` | `adjacentCoords(world, noid)` | built for doors; generalize using per-class walk offsets (future: from image data; for now per-class table) |
| `v_goXY` / `v_start_walk` | `await ctx.walkTo(x, y, how)` | client callback (already built) |
| `v_face_cursor` | `ctx.face(direction)` | client callback; sagebot has faceDirection |
| `sound N` / `complexSound N` | `ctx.sound(n)` | client callback; **sagebot: no-op**, future client: plays it. Sound resource table deferred. |
| `newImage noid, state` | `ctx.newImage(noid, state)` | client callback; world model already tracks gr_state — renderer hook only |
| `v_balloon_printf "..."` / `balloonMessage` | `ctx.balloon(text)` | client callback; sagebot: feed to Claude as object speech |
| `incLight` / `decLight` | `ctx.changeLight(±1)` | world.region.lighting += n, plus client render hook |
| `v_text_handler` | `ctx.textHandler(cmd)` | Tier-4 stub (book/paper page I/O) |
| `v_spend` / `v_select_denomination` | token helpers in kernel | needed by all coinOp behaviors |
| `v_create_object` / `UnCreate` | `world._makeObject` / `_deleteByNoid` | already built |
| `v_go_to_new_region` / `v_wait_for_region` | `ctx.changeRegion(direction)` | client capability (bridge_v2 handles transit); behavior just requests it |

Context object passed to every behavior (mirrors the C64 zero-page
"registers" exactly):

```js
// dispatch(world, verb, noid, client) builds:
ctx = {
  world,                  // the HabitatWorld
  actor,                  // record: my avatar (C64 actor_*)
  pointed,                // record: object the verb targets (C64 pointed_*)
  inHand,                 // record|null: held item (C64 in_hand_*)
  args,                   // verb arguments (cursor x/y, host msg fields)
  ...kernel,              // everything in the table above
}
```

## 3. The class-to-resource table

`new.mud` (95 classes, 850 action slots, 143 unique behaviors) becomes
`habiworld/lib/classes.js`, transcribed **mechanically** — a one-off
parser script reads new.mud and emits the module, so the table provably
matches the original. Behavior slots only for now; `sounds` and `images`
arrays are emitted as name strings (not resources) to reserve the shape
for the future.

```js
// generated from sources/c64/Behaviors/new.mud — do not hand-edit
const B = require('./behaviors')
module.exports = {
  23: { name: 'class_door',
    actions: [                      // index = ACTION_* slot
      B.generic_adjacentOpenClose,  // 0 do
      B.illegal,                    // 1 reverse-do
      B.generic_goToOrPassThrough,  // 2 go
      B.generic_cease,              // 3 stop
      B.illegal,                    // 4 get
      B.generic_goToAndDropAt,      // 5 put
      B.generic_broadcast,          // 6 talk
      B.generic_destroy,            // 7 destroy
    ],
    sounds: ['door_opening', 'door_closing'],   // names only, for later
  },
  // ... 94 more
}
```

Class lookup key: mod type name → class number (we already know the
mapping from Constants.java `CLASS_*`; the table keys on number, with a
name index alongside).

Naming rules (the .m → .js function name is otherwise 1:1):
- `avatar_GETM` / `avatar_PUTM` (new.mud names) → files
  `avatar_GET_uppercase.m` / `avatar_PUT_uppercase.m`; JS uses the
  new.mud names (`avatar_GETM`)
- `generic_CHANGESTATE` → file `generic_CHANGESTATE_uppercase.m`
- `*.bad.m`, `temp.m`, includes (`action_head.i`, `vectors.m`,
  `class_equates.m`, `messages.i`) are excluded

## 4. Port tiers (143 behaviors)

**Tier 0 — already built, refactor under original names (~8):**
`generic_goToAndGet`, `generic_goToAndDropAt`, `generic_adjacentOpenClose`,
`generic_throw`, `generic_goTo`, `avatar_GRABFROM` (our HAND),
plus the ~25 slot-8+ handlers living in deltas.js (`avatar_WALK`,
`avatar_THROW`, `avatar_WEAR`...).

**Tier 1 — trivial, minutes each (~10):** `illegal` (boing), `noEffect`
(beep), `generic_cease`, `unimplemented`, `BOING`, `generic_depends`,
`depends`, `generic_test`, `sky_go`/`wall_go`/`trap_go` (beep variants).
With Tier 0 these cover **~700 of 850 slots**.

**Tier 2 — single send + state update, template-stamped (~60):**
`flashlight_do`, `generic_ON/OFF/ONLIGHT/OFFLIGHT`, `generic_switch`,
`generic_read`, `generic_changeState`, `generic_doMagic`,
`generic_wearHead/Torso/Legs`, `key_do`, `die_ROLL` path, the remaining
goToAnd* family (`DropInto`, `PickFrom`, `*IfOpen`, `Fill`,
`goToFurniture`, `goToCursor`, `goToOrPassThrough`), simple device dos.
All follow the same shape: precondition → optional walk → sendMsg →
getResponse → state mutation → sound/newImage. One template, parameters
per behavior, each cited to its .m source like deltas.js does.

**Tier 3 — multi-message state machines (~40):** `generic_coinOp` (and
coke/fortune/jukebox/parking_meter/teleport PAY chains), `vendo_*`,
`atm_*`, `telephone_*`/`phone_booth_*`, `magic_lamp_*`, `fare_box_*`,
`garbage_can_*`, `pawn_machine_*`, `sensor_*`, `stereo_*`/`tape_LOAD`,
`grenade_*`, gun family (`gun_do`, `fake_gun_*`, `stun_gun_rdo`,
`generic_shoot`/`strike`). Hand-ported, each with tests.

**Tier 4 — client-infrastructure dependent, explicit stubs (~25):**
`avatar_DIE`/`avatar_REINCARNATE` (death sequence), `GoToNewRegion`/
`transit_region`/`generic_enterOrExit` (region transit — bridge_v2 owns
this for bots), text-handler users (`book_do`, `paper_do`,
`generic_sendMail` page I/O), ESP/`elevator_ZAP*`/`teleport_ZAP*`,
`fn_key_pressed`, `change_player_color`, `toggle_walking_music`,
`do_a_gesture`/`avatar_gesture` (pure choreography). These get real
function bodies that do the world-model part and call `ctx` capabilities
that sagebot stubs; a future game client implements them fully. Each
stub returns `{ ok: false, reason: 'needs-client-capability:<x>' }` if
the capability is missing rather than silently lying.

## 5. File layout

```
habiworld/
  lib/
    behaviors/
      kernel.js              # ctx construction + macro vocabulary
      dispatch.js            # GetAction equivalent + depends/doMyAction re-entry
      index.js               # exports all behaviors by name (B.*)
      generic_goToAndGet.js  # one file per .m, same name, header cites source
      generic_goTo.js
      avatar_WALK.js         # slot-8+ handlers migrate from deltas.js
      ...
    classes.js               # generated class-to-resource table
    tools/parse_mud.js       # one-off new.mud → classes.js generator
  test/
    behaviors/               # per-tier tests on the recorder fixture
```

`world.apply()` keeps its current shape; incoming host messages route
through the class table (slot 8+) instead of deltas.js's flat op map.
deltas.js survives during migration as the implementation the table
points at, then dissolves.

## 6. Phases

1. **Kernel + dispatcher** — ctx, the macro vocabulary, `dispatch()`,
   `depends`/`doMyAction` re-entry. Port Tier 1 to prove it (they're the
   dispatcher's edge cases anyway).
2. **Generate classes.js** — write `parse_mud.js`, emit the table with
   every not-yet-ported behavior pointing at an auto-generated
   `unported(name)` stub that fails with `unported:<name>` (a flagged
   result rather than a throw, so bot loops degrade gracefully while
   the missing port stays visible).
3. **Tier 0 refactor** — move actions.js recipes + deltas.js handlers
   under original names; sagebot's `performAction` verbs become
   `dispatch(ACTION_GET, ...)` etc. Everything that works today still
   works, now through the real table. **~700/850 slots live.**
4. **Tier 2 sweep** — template-stamp the single-send behaviors. Wire
   sagebot's remaining legacy tools (toggle_device, wear_item, read…)
   through dispatch.
5. **Tier 3** — state machines, hardest-first (coinOp unlocks five
   classes). 
6. **Tier 4 stubs + capability audit** — document exactly what a future
   JS game client must implement (`sound`, `chore`, `newImage`,
   `balloon`, `textHandler`, `changeRegion`, gestures).

Automation check after phase 4: diff every behavior's send/response/
state-mutation sequence against the .m source as a review pass —
the macro DSL is constrained enough that this is a line-by-line
correspondence check, not a reinterpretation.
