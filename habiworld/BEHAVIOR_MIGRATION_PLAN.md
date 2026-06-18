# Habiworld: deltas.js → full C64 behavior migration

> **Status:** planned (not started)  
> **Goal:** Retire the aggregate `deltas.js` inbound path; route all async host
> messages through class-table behaviors (Rule #1: one `Behaviors/*.m` → one
> `lib/behaviors/<name>.js`). Presentation (sound, chore, newImage, balloons)
> flows through `ctx.*` client callbacks — the same seam the C64 used.

## Why we're doing this

The C64 client has **no `deltas.m`**. Inbound `OPENCONTAINER$`, `FLUSH$`, `WALK$`,
etc. dispatch through `GetAction(class, slot)` to the matching `Behaviors/*.m`
handler, which does state **and** choreography in one place.

`deltas.js` was bootstrap scaffolding: a flat op→`apply()` map that ports **state
effects only** and deliberately strips sound/chore ("belongs to a renderer"). That
split created three partial implementations:

| Layer | Role today |
|-------|------------|
| `lib/deltas.js` | Inbound state only (`world.apply` live path) |
| `lib/behaviors/` | Outbound `dispatch()` with `ctx.sound` / `ctx.chore` |
| `lib/behaviors/host_messages.js` | Class-table-shaped stubs → `applyDelta()` only |
| Web `avatar-chore.js` | Ad-hoc gesture map (fourth partial port) |

Sound and animation do not "just work" because inbound messages never run the
behaviors that call `ctx.sound`. This plan rolls that back.

## Rule #1 (design constraint)

1. Every `Behaviors/*.m` → `lib/behaviors/<name>.js` (same name as `new.mud`).
2. Inbound host messages dispatch through `classes.js` slot 8+ to that behavior.
3. No op-specific logic in aggregate tables (`deltas.js` is deleted when done).
4. State mutations live inside behaviors (or thin `world._*` helpers they call).
5. Presentation only via `ctx.*` → client callbacks (`sound`, `chore`, `newImage`,
   `balloon`, `face`, `changeLight`). Bots pass no-op/stub callbacks; the web
   client implements them fully.

## Current inventory

| Asset | Count |
|-------|------:|
| Ops in `deltas.js` | 50 |
| With `apply()` (state ported) | 33 |
| `choreography: true` (delta no-ops) | 17 |
| Registered behaviors | 155 |
| `host_messages.js` stubs | 20 |
| habiworld tests | 74 (all must stay green) |

### State ops already in deltas (migrate into behaviors)

`WALK$`, `GET$`, `PUT$`, `GRABFROM$`, `FIDDLE_$`, `CHANGELIGHT_$`, `GOAWAY_$`,
`THROW$`, `WEAR$`, `REMOVE$`, `OPEN$`, `CLOSE$`, `OPENCONTAINER$`,
`CLOSECONTAINER$`, `CHANGE$`, `SEXCHANGE$`, `ROLL$`, `RESET$`, `FILL$`, `POUR$`,
`SCAN$`, `ON$`, `OFF$`, `SIT$`, `SPRAY$`, `VSELECT$`, `CHANGE_CONTAINERS_$`,
`WIND$`, `PAY$`, `PAYTO$`, `PAID$`, `SELL$`, `POSTURE$`

### Choreography ops (need real behavior ports)

`SPEAK$`, `OBJECTSPEAK_$`, `PLAY_$`, `ATTACK$`, `BASH$`, `FAKESHOOT$`, `RUB$`,
`WISH$`, `WISH_MESSAGE`, `TAKE$`, `BUGOUT$`, `DIG$`, `MUNCH$`, `FLUSH$`, `ZAPTO$`,
`APPEARING_$`, `WAITFOR_$`

(`POSTURE$` has partial state in deltas; full port includes chore.)

## Target architecture

```
Inbound wire message
        │
        ▼
world.apply(msg)
        │
        ├── session ops (make / delete / changeContext) — unchanged
        │
        └── host message
                │
                ▼
        resolveHostDispatch(msg) → { pointed, slot, args }
                │
                ▼
        dispatchHost(world, pointed, slot, args, client)
                │
                ▼
        behavior from classes.js slot table
                │
                ├── world._* helpers (shared primitives)
                ├── state mutation
                └── ctx.sound / ctx.chore / ctx.newImage / …
                        │
                        ▼
                client callbacks (habisound, habirender, …)
```

`PLAY_$` remains a valid wire op; it becomes a thin behavior (or stays as a
server-broadcast special case) — not the primary sound path.

## Strategy: incremental, not big-bang

Migrate **one op at a time** (or one family at a time) with:

- `MIGRATED_OPS` set — ops routed through `dispatchHost`
- Legacy fallback — unmigrated ops still call `applyDelta`
- Optional shadow mode — run both paths, diff world snapshot, log divergence
- Tests + capture fixtures must pass before removing an op from `deltas.js`

Big-bang delete of `deltas.js` is possible but risks sagebot regressions and
obscures which op broke. Incremental is preferred.

---

## Phase 0 — Lock target model (documentation only)

- [ ] Add Rule #1 to this file (done above)
- [ ] Document **op → slot → pointed-object** resolution table (wire shapes vary:
      `msg.noid` = actor vs container vs target — see `Constants.java` and Java
      `send_neighbor_msg` call sites)
- [ ] Cross-link `BEHAVIORS.md` §5–6 (planned routing) — note this plan supersedes
      the "deltas survives during migration" wording once Phase 4 completes

---

## Phase 1 — Infrastructure (no op migration yet)

**Files:** `lib/behaviors/dispatch_host.js` (new), `lib/world.js`, `index.js`

- [ ] `resolveHostDispatch(msg)` → `{ pointedNoid, slot } | null`
      - Map wire `op` string → host message slot number (`Constants.java`)
      - Resolve which object record is `pointed` (per-op: `noid`, `cont`,
        `target`, class-specific rules)
- [ ] `dispatchHost(world, pointed, slot, args, client)` — like `dispatch()` but:
      - No `send`/`walkTo` required for observer-only behaviors
      - `args` = raw message fields
      - Default `client` = noop presentation (`kernel.js` already no-ops missing hooks)
- [ ] `world.apply` change:

  ```js
  if (MIGRATED_OPS.has(msg.op)) {
    const spec = resolveHostDispatch(msg)
    if (spec) await dispatchHost(world, spec.pointed, spec.slot, msg, this._client)
  } else {
    applyDelta(world, msg)
  }
  this.emit('op', msg)
  ```

- [ ] `world.setClient(client)` or constructor option — web client registers
      presentation callbacks once
- [ ] `HABIWORLD_SHADOW=1` env: run `applyDelta` + `dispatchHost`, deep-compare
      object table, log `shadow-divergence:<op>`
- [ ] Extract shared mutation helpers from delta `apply()` bodies where behaviors
      will call them (e.g. `applyOpenFlags`, `purgeContainerContents`) — **do not**
      delete delta entries yet
- [ ] Tests: infrastructure smoke test (dispatchHost called with noop client, no throw)

**Exit criteria:** `npm test` green; `MIGRATED_OPS` empty; no behavior change.

---

## Phase 2 — Pilot ops (prove sound + chore loop)

### 2a — `FLUSH$` → `garbage_can_FLUSH`

Best first candidate: behavior already exists in `lib/behaviors/gadgets.js` with
`ctx.sound('GARBAGE_FLUSH')` + content purge. Delta marks `FLUSH$` as
`choreography: true` (no state in deltas today).

- [ ] Add `FLUSH$` to `MIGRATED_OPS`
- [ ] Pointed object = `msg.noid` (garbage can), slot = 8
- [ ] Shadow-run until clean on capture fixtures
- [ ] Web client: register `client.sound` via `soundClientCallbacks`
- [ ] Remove `FLUSH$` from `deltas.js`
- [ ] Test: inbound `FLUSH$` invokes sound callback (recorder/mock client)

### 2b — `OPENCONTAINER$` / `CLOSECONTAINER$`

Replace `host_messages.avatar_OPENCONTAINER` / `avatar_CLOSECONTAINER` stubs.

- [ ] Full port of `avatar_OPENCONTAINER.m` / `avatar_CLOSECONTAINER.m`:
      - Merge state logic from current delta `apply()`
      - Merge presentation from outbound `generic_adjacentOpenCloseContainer`
        (`ctx.chore`, `ctx.sound('CONTAINER_OPENING'/'CONTAINER_CLOSING', cont)`)
- [ ] Pointed = avatar (`msg.noid`), args include `cont`
- [ ] Add to `MIGRATED_OPS`, shadow, cutover, delete delta entries
- [ ] Web client: remove matching `OP_GESTURE` entries from `avatar-chore.js` once
      `ctx.chore` wired

### 2c — `OPEN$` / `CLOSE$` (doors)

Same pattern as containers; merge `generic_adjacentOpenClose` sound (`EXIT_OPENING` /
`EXIT_CLOSING`) into `avatar_OPEN` / `avatar_CLOSE` host ports.

- [ ] Full ports, migrate, delete delta entries
- [ ] Web client chore + sound

**Exit criteria:** Sagebot hears nothing (noop client); web client hears container +
door sounds on neighbor actions; `npm test` green.

---

## Phase 3 — Migrate by family

Work in parallel where possible. Order by web-client payoff.

### Avatar inventory

`GET$`, `PUT$`, `GRABFROM$`, `THROW$`, `WEAR$`, `REMOVE$`

- [ ] Upgrade `host_messages` stubs → full `.m` ports (chores: `arm_get`, `hand_out`,
      `bend_over`, etc.)
- [ ] Delta `apply()` bodies become behavior internals
- [ ] Migrate, shadow, cutover per op

### Avatar motion

`WALK$`, `POSTURE$`

- [ ] `avatar_WALK`, `avatar_POSTURE` full ports
- [ ] Coordinate with web client walk replay (`avatar-chore.js`) — goal is
      `ctx.chore` driving motion, not duplicate maps

### Choreography-only (17 ops)

Port or wire existing partial behaviors:

| Op | Existing behavior hint |
|----|------------------------|
| `DIG$` | `shovel_DIG` (sound only — already ported) |
| `MUNCH$` | `pawn_machine_MUNCH` (stub today) |
| `FLUSH$` | Phase 2a |
| `ATTACK$`, `BASH$` | new `avatar_ATTACK`, `avatar_BASH` ports |
| `PLAY_$` | thin behavior or `ctx.sound` by sfx index |
| … | cite `Behaviors/*.m` per op |

- [ ] One PR per family or per op depending on size

### Object host slots

`FILL$`, `POUR$`, `ROLL$`, `RESET$`, `SCAN$`, `ON$`, `OFF$`, `WIND$`, `SPRAY$`,
`CHANGE$`, `SEXCHANGE$`, …

- [ ] Class-specific behaviors already exist for many; upgrade host delegate stubs

### Region / session

`FIDDLE_$`, `CHANGELIGHT_$`, `GOAWAY_$`, `CHANGE_CONTAINERS_$`, `VSELECT$`

- [ ] Region and meta ops — may stay as `world._*` helpers called from behaviors

### Commerce

`PAY$`, `PAYTO$`, `PAID$`, `SELL$`

- [ ] Behaviors exist (`vendo_SELL`, etc.); wire inbound path

---

## Phase 4 — Delete deltas.js

- [ ] `MIGRATED_OPS` = all 50 ops
- [ ] Shadow mode clean on:
      - `npm test` (74 tests)
      - `test/capture_to_fixture.test.js` recorded streams
      - Manual sagebot session (world model unchanged)
- [ ] Delete `lib/deltas.js` (or reduce to test-only fixtures)
- [ ] Delete auto-generated `host_messages.js` stub factory — each name is a real file
- [ ] Update `README.md`: remove "choreography out of scope" / "renderer subscribes"
- [ ] Update `BEHAVIORS.md` status section
- [ ] Remove `DELTAS` from `index.js` public exports (or keep as deprecated alias briefly)

---

## Phase 5 — Client presentation layer

**Web client** (`webclient/lib/`):

- [ ] `presentationClient(hs, world, avatarMotion)`:

  ```js
  {
    sound:   soundClientCallbacks(hs, world, classes).sound,
    chore:   (act, noid) => …,           // delegate to avatarMotion or renderer
    newImage:(noid, state) => …,         // emit fieldChanged / refresh
    balloon: (text) => …,                // Phase 4 balloons
    beep, boing,
    walkTo, send, animationWait,         // Phase 6 outbound input
  }
  ```

- [ ] Register on `world.setClient(...)` at connect
- [ ] Remove `wireSoundToWorld` `PLAY_$`-only hack once behaviors cover sounds
- [ ] Shrink `avatar-chore.js` `OP_GESTURE` as behaviors absorb chores
- [ ] `SOUND_TRACE` off when pilot ops verified

**Sagebot** (`habibots/habibot.js`):

- [ ] No change required — noop presentation is correct
- [ ] Optional: log `ctx.balloon` already works; add debug log for `ctx.sound` in dev

---

## Phase 6 — Outbound input (separate track)

Not blocking sound migration, but completes the C64 loop:

- [ ] Web client `dispatch()` for user verbs (pie menu, Phase 5–6 roadmap)
- [ ] Same `presentationClient` passed to outbound `dispatch()` and inbound
      `dispatchHost()` — one behavior codebase, two directions

---

## Per-op migration checklist (template)

Copy for each op PR:

```
Op: ___________
Behavior: ___________
Pointed object rule: ___________
Slot: ___________

[ ] Full .m port (state + presentation)
[ ] Added to MIGRATED_OPS
[ ] Shadow mode clean (if enabled)
[ ] world.test.js updated
[ ] behaviors.test.js updated (mock client asserts ctx.sound/chore calls)
[ ] capture fixture replay clean
[ ] Removed from deltas.js
[ ] host_messages stub removed / replaced
[ ] Web client duplicate logic removed (if applicable)
```

---

## Effort estimate

| Chunk | Relative size |
|-------|---------------|
| Phase 1 infrastructure | Small (1–2 days) |
| Phase 2 pilot (FLUSH + containers + doors) | Medium — unblocks web sound |
| 20 host stub upgrades | Medium — template-heavy |
| 17 choreography ops | Medium — many are short `.m` files |
| Remaining state ops | Larger — delta `apply()` is the spec |
| Phase 4 cleanup | Small |

**Rough total:** 3–5 PRs to hear container/door/flush sounds in web client;
10–15 PRs to delete `deltas.js` entirely.

---

## References

- `BEHAVIORS.md` — original port plan, kernel macro table, tier breakdown
- `lib/deltas.js` — current aggregate table (to be retired)
- `lib/behaviors/host_messages.js` — stub delegates (to be replaced)
- `lib/behaviors/dispatch.js` — outbound `dispatch()` (model for `dispatchHost`)
- `lib/behaviors/gadgets.js` — `garbage_can_FLUSH`, `shovel_DIG` (good port examples)
- `lib/behaviors/containers.js` — outbound container sounds (merge into avatar host ports)
- `webclient/lib/sound.js` — `soundClientCallbacks` (ready, not wired)
- `webclient/lib/avatar-chore.js` — duplicate gesture map (shrink as behaviors migrate)
- Java `Constants.java` — host message slot numbers
- C64 sources: `sources/c64/Behaviors/*.m` (MADE habitat repo)

---

## Open questions

1. **Shadow mode default?** On in CI, off locally — or always on until Phase 4?
2. **`world._client` lifetime** — set per connect, or global singleton for web client?
3. **`POSTURE$`** — delta already writes `activity` for persistent postures; does full
   port move that into `avatar_POSTURE` and remove delta apply entirely?
4. **Tier-4 stubs** (`avatar_DIE`, region transit) — stay as explicit
   `needs-client-capability` returns; not blocking this migration.