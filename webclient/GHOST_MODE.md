# Ghost mode — behavior guide (Phase 6c)

Working guide for implementing ghost mode in the webclient. **C64 is ground truth**
(RULE #1); the elko/Java server is cross-checked as the second source. Read the `.m`,
don't guess.

> A ghost has **no avatar**, so it can do **almost nothing**. It is an observer. The entire
> feature is mostly about *taking things away*: a ghost's command set collapses to "drift to
> an adjacent region" and "come back to life." Everything else beeps.

## What a ghost is

- There is **one** `Ghost` object per region, at the fixed noid **`ghost_noid = 255`**
  (`Main/farmers_equates.m:41`, `Constants.GHOST_NOID`). It is a singleton that *represents
  all* observer-only users collectively — not one body per ghost
  (`mods/Ghost.java`: "always a Ghost object … represents all of the users … observer only";
  `total_ghosts` counts the connections behind it). Class `class_ghost = 3`
  (`class_equates.m:10`).
- The server keeps a full `Avatar` per connection regardless; it just sets `amAGhost = true`
  and hides the body. On the **client** the avatar is "forgotten" — you ARE noid 255
  (`Ghost.java:CORPORATE` comment; C64 sets `me_noid = ghost_noid`).
- Detecting "I am a ghost" on the C64: `me_noid == ghost_noid` (255). Several call sites do
  `ldy me_noid; iny; if (zero)` — i.e. `0xFF + 1 == 0` → ghost (`actions.m:170`).
- The ghost is **visible** — it renders as a floating **eye** icon: `class_ghost` carries
  `image ghost_image` = `Images/eye0.bin` (`beta.mud:378-394`). The single eye is shown to
  ghosts and avatars alike whenever observers are present (so it is NOT filtered from the
  render). It sits at the server's fixed spot `Ghost(0, 4, 240, …)` (`Region.java:190`).

## Ghost instance creation timing (CRITICAL — both bugs lived here)

The Ghost is an **irregular sentinel noid (255)**, like the region (0), and it is created and
delivered out of band — you cannot assume it is in the table when you need it:

- **Created lazily, announced ~1s LATE.** `Region.getGhost()` (`Region.java:187`) creates the
  singleton only on first need and announces it via `announceGhostLater`, a thread that
  **sleeps 1000ms** before sending the eye's `HEREIS_$` (`Region.java:201-211`). `create_object`'s
  4th arg is `ephemeral`, *not* announce — so nothing announces the eye synchronously.
- **The corporeality reply arrives BEFORE the body's make, in BOTH directions:**
  - *Discorporate* (`switch_to_ghost`, `Avatar.java:785`): sends the reply immediately; the eye's
    `HEREIS_$` is the ~1s-late announce (or already present if other ghosts exist).
  - *Deghost* (`switch_to_avatar`, `Avatar.java:816`): `from.send(reply)` at :853 happens **before**
    `fakeMakeMessage(self)` at :854 — the reincarnated avatar's make (a plain `make`, **no**
    `you:true`) follows the reply, then a `ready` op.
- **Your own old body is removed only for neighbors.** `switch_to_ghost` sends `GOAWAY_$` for
  your avatar to *neighbors* (`send_neighbor_msg`); `destroyGhost` likewise GOAWAYs the eye to
  *neighbors*. The acting client never gets those — it must delete its own stale body, exactly
  as `toggle_ghost_mode.m` does with `v_delete_object me_noid`.

**Entering already a ghost (persisted DB state, or forced on a full-region arrival).** elko
marks your own User object `you:true`, but for a ghost that object is your **Avatar carrying
`amAGhost:true`** with an **UNASSIGNED noid** (the avatar isn't in the region;
`objectIsComplete` returns early at `Avatar.java:391`, `removeFromObjList` sets noid 256). The
client must NOT treat that as a normal avatar — it would add/render a stray body and look
corporeal. Instead, a `you:true` Avatar make with `amAGhost` ⇒ adopt **meNoid = 255** and drop
the stray body; the eye arrives as a normal region make (or ~1s late as the first ghost) and
`me` resolves to it. This is the fix for "connect as a ghost but the client isn't in ghost
state." (`world._makeObject`.)

**Consequence for the client model:** identity must be a **noid number** (`me_noid`), not a
record. habiworld tracks `world.meNoid`; `world.me` is a getter that resolves it (null until the
body's make lands); `world.amGhost` is `meNoid === GHOST_NOID`. `setMeByNoid(newNoid)` sets the
noid from the reply immediately, and `_makeObject` adopts a late make whose noid matches
`meNoid` (emitting so the client re-renders). The toggle deletes the stale body itself
(`removeNoid(oldNoid)` on discorporate; `removeNoid(255)` when you were the last ghost).

## How you become a ghost

1. **Forced on region entry — no room.** When you enter a region that can't seat you, you
   arrive as the ghost. `Region.isRoomForMyAvatar` (`Region.java:437`) returns false when
   either:
   - `avatarsPresent == max_avatars` (the region is full), or
   - `space_usage + instanceSize >= c64_capacity()` (not enough of the emulated C64 heap;
     the first avatar in a ghost-only region needs `FIRST_AVATAR_HEAP_SIZE`).
   This is the classic "dozens of people watch a performance" case.
2. **Voluntary — F1.** The F1 key (`toggle_ghost_mode`, Region action slot 9) toggles
   corporeality. See *Deghost protocol* below for the op routing.

On arrival as a ghost the client **frees the cursor immediately** — no `FINGER_IN_QUE`
handshake (`actions.m:170-172` "free up cursor NOW, I am a ghost!"). The server greets you
with MOTD + "You are a ghost. Press F1 to become an Avatar." (`Region.java:255-264`).

## What a ghost CAN do (the entire list)

1. **Observe.** See the region, avatars, objects, word balloons, hear sound. Passive.
2. **GO to an adjacent region** (region transit only). A ghost's GO does **not** walk
   in-region — `goXY` sets `go_success` then `rts` early for a ghost without sending WALK
   (`actions.m:456-466`). The only GO that does anything is leaving through an edge →
   `Ghost.NEWREGION {direction, passage_id}` to noid 255 (`Ghost.java:128`). Transit waits
   only on the reply, not the (nonexistent) walk animation (`actions.m:896-901`).
3. **Deghost** (come back to life) — F1 / region command slot **9** when pointed at the
   region. This is the *only* non-GO command a ghost may issue (`actions.m:274-284`).

## What a ghost CANNOT do (everything else → beep / illegal)

The C64 gate is blunt (`actions.m:272-294`): if `actor_noid == ghost_noid`, the only allowed
commands are `COMMAND_GO` and (region-pointed) command `9` (deghost); **everything else falls
to `no_go` → `beep`**. Concretely:

- **No in-region walking** (`goXY` early-rts; no WALK sent).
- **No object verbs:** DO, GET, PUT, TALK on any object or avatar.
- **No POSTURE / gestures / sit-stand**, **no SPEAK / ESP** (a ghost casts no word balloon),
  **no GRAB / HAND / TOUCH**, no inventory / pocket operations.
- **F-keys that act through the avatar are blocked** — the server rejects `FNKEY` and avatar
  `HELP` while `amAGhost` (see below). (`Ghost.HELP` answers a ghost-count string instead.)

### Server enforcement (defense in depth — not the client's job, but confirms the limits)

These `Avatar` `@JSONMethod`s `illegal_request(... "Avatar commands not allowed when a
ghost.")` when `amAGhost` (`Avatar.java`): `GRAB`(535), `HAND`(576), `POSTURE`(620),
`SPEAK`(655), `WALK`(703), `NEWREGION`(745), `ESP`(885), `SITORSTAND`(939), `TOUCH`(1013),
`USERLIST`(1133), `FNKEY`(1188), `HELP`(1226), plus the two avatar-to-avatar verbs that also
reject when the *other* party is a ghost. The client must **pre-block** these so the user
gets an immediate beep instead of a round-trip rejection.

## Deghost protocol (F1 toggle)

The C64 sends one toggling message, `MSG_CHANGE_CORPOREALITY`, to `me_noid`
(`Behaviors/toggle_ghost_mode.m:28`). Because `me_noid` is the avatar when corporeal and 255
when a ghost, NeoHabitat splits it into two ops by target:

- **Corporeal → ghost:** send **`DISCORPORATE`** to my avatar ref (`Avatar.java:761`).
  Refused while holding the Genie or a restricted object. Plays sfx 5, broadcasts `GOAWAY_$`
  for my noid, frees my noid + pocket noids.
- **Ghost → avatar:** send **`CORPORATE`** to the ghost object (noid 255 / its ref)
  (`Ghost.java:108` → `switch_to_avatar`). Plays sfx 8; succeeds only if
  `isRoomForMyAvatar` now passes.

Reply codes (`toggle_ghost_mode.m:15-24`, `Avatar.java:780-783`):

| code | meaning | client action |
|------|---------|---------------|
| 0 `COPOREAL_FAIL` | no room | `boing` — stay a ghost |
| 1 `COPOREAL_SUCCESS` | became an avatar; body vector follows | adopt new noid; unpack body into region |
| 2 `COPOREAL_ALREADY_THERE` | success, you already have the object (became a ghost) | adopt `newNoid` (=255) |
| 3 `COPOREAL_LAST_GHOST` | success **and** you were the last ghost | as 1, **plus** delete the old ghost object |

On a corporeal-success reply the C64 sets `me_noid`/`Who_am_I` ← `newNoid`, updates
`bank_account_balance` from the reply, and unpacks the returned body
(`unpack_contents_vector`) (`toggle_ghost_mode.m:30-60`). Reply also carries `balance`.

## Webclient implementation plan — STATUS

1. **Track the ghost flag. — DONE.** `world.amGhost` getter (`me.noid === GHOST_NOID ||
   type Ghost || mod.amAGhost`), `world.ghost()` (the noid-255 record), `world.setMeByNoid()`
   for the identity swap. `GHOST_NOID = 255` in constants.
2. **Gate verb dispatch (the core of 6c). — DONE.** `dispatch()` beeps every verb except GO
   for a ghost (`ghost-no-verb`); `ctx.walkTo` is a ghost no-op (goXY rts) so an in-region GO
   does nothing while edge-transit still routes through `changeRegion`; `performGesture` and
   non-F1 `performFnKey` beep for a ghost. All in habiworld, mirroring `actions.m:272-294`.
3. **F1 toggle. — DONE.** `B.toggle_ghost_mode` + `performFnKey` slot 9: corporeal →
   `DISCORPORATE` to my avatar; ghost → `CORPORATE` to noid 255. Handles reply codes
   0/1/2/3, swaps identity via `setMeByNoid(newNoid)`, updates `bankBalance`; the body /
   GOAWAY arrive on the normal broadcast path. F1 is wired in the webclient F-key handler.
4. **Rendering. — DONE.** The eye (`class_ghost` → `Images/eye0.bin`) renders like any prop
   via `beta.mud` (the renderer's mud); it is **not** filtered. Your own avatar is removed
   locally by the toggle (`removeNoid`) since the server's `GOAWAY_$` only reaches neighbors.
   The browser cursor is always free, so the C64 "free cursor on ghost arrival" is automatic.
   Identity is `meNoid` + a `me` getter so the ~1s-late eye / the post-reply deghost avatar is
   adopted the moment its make lands (see *Ghost instance creation timing* above).
5. **Interplay with 6d (region transit). — pending 6d.** Ghost GO is *only* region transit, so
   real ghost movement waits on the `changeRegion` client capability 6d introduces (today it
   returns `needs-client-capability:changeRegion`). Input-gating + deghost are complete here;
   edge-transit rides on 6d. Entry as ghost vs. avatar is the server's room check — the client
   renders whichever identity the make-storm hands it.

Tests: `habiworld/test/behaviors.test.js` — 8 ghost tests (detection, verb/gesture/F-key
gating, GO no-op, F1 deghost identity swap, become-ghost, denial boing). All 133 pass.

## Open questions to resolve while building

- **How does our make-storm signal "you are the ghost"?** Confirm the webclient receives the
  ghost as `you:true` at noid 255 (vs. an avatar make) and that habiworld sets `world.me`
  accordingly. Verify against a live full-region capture.
- **Cursor/observer affordances.** With only GO+deghost available, what does the cursor offer?
  Likely: edge-transit targets (shared with 6d) + an F1 prompt. No pie-menu verbs.
- **Forced-ghost on transit.** When 6d walks us off an edge into a full region, the arrival
  make-storm will seat us as a ghost — make sure the input-gating flips on automatically from
  the make-storm, not from a separate signal.
