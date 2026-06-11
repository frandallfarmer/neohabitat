# habiworld

A client-side **Habitat world model** for JavaScript: feed it the
elko/neohabitat JSON message stream and it maintains a faithful mirror of
region state — the object table, container tree, avatar positions, and
region properties — exactly the way the original 1986 C64 client did.

```js
const { HabitatWorld, constants } = require('habiworld')

const world = new HabitatWorld()
connection.on('message', (msg) => world.apply(msg))

world.holding(world.me.noid)      // what am I carrying? (HANDS slot)
world.inventory(world.me.noid)    // everything in my pockets
world.avatars()                   // who's here, with live positions
world.region.orientation          // region orientation, neighbors, lighting
```

## Why this exists

The elko server describes a region once at entry (the "make storm") and
afterwards sends only small delta ops — `WALK$`, `GET$`, `PUT$`,
`FIDDLE_$`, … — that the client is expected to apply to its local object
table. The original C64 client did exactly that; a JS consumer that keeps
only the make-storm snapshot goes stale on the first pickup, hand-off, or
walk (see neohabitat issues #545 and #564, where SageBot insisted its
hands were empty while visibly holding a flashlight).

habiworld is that missing client-side state layer, isolated as a library:

- **Bots** (habibots) read world state through the query methods.
- **A future 100% JS client** can drive rendering/animation by
  subscribing to the emitted events (`added`, `removed`, `moved`,
  `containerChanged`, `fieldChanged`, `lighting`, `regionDescribed`,
  plus raw `op` for everything) while delegating all state to this
  module. Choreography is deliberately out of scope here.

No dependencies; Node ≥ 18 (uses `node:test` for tests).

## Fidelity and provenance

The delta table (`lib/deltas.js`) is ported from the **state effects** of
the original C64 client's message handlers
([MADE habitat repo](https://github.com/Museum-of-Art-and-Digital-Entertainment/habitat),
`sources/c64/Behaviors/*.m` and `Main/actions.m`), cross-checked against
the op set the neohabitat Java server actually emits (every
`send_neighbor_msg` / `send_broadcast_msg` / fiddle / goaway call site).
Each entry cites its original source. Example: `GET$` is
`Behaviors/avatar_GET_uppercase.m` line 40 — `changeContainers 0,
AVATAR_HAND, actor_noid` — minus the bend-over chore.

Every op the server can send has a **deliberate** entry, one of:

| status | meaning |
|---|---|
| ported | state mutation applied, citing the original handler |
| `choreography: true` | intentionally no state effect (animation/sound/text only) |
| `todo: true` | known op, state effect not yet ported — emits `unhandledDelta` |

Silent fall-through is the failure mode that produced the original bugs,
so it is structurally impossible here: unknown ops are still emitted as
raw `op` events and `todo` ops are observable via `unhandledDelta`.

### Deliberate divergences from the C64 implementation

- **Contents lists are derived, not maintained.** `Main/actions.m`
  updates per-container slot arrays inside `change_containers`; we derive
  `contentsOf()` by scanning the (tiny) object table instead. Same
  semantics, no desync risk.
- **No resource paging / render flags.** The C64 `change_containers`
  also shuffled display memory; renderers should react to events.
- **`y` is stored raw**, preserving its C64 dual meaning: screen
  coordinate when the container is the region, slot index when inside a
  container, and avatar walk destinations keep the FOREGROUND bit OR'd
  in, exactly as on the wire.

## Status

Experimental. Ported so far:

| op | effect |
|---|---|
| `WALK$` | avatar position |
| `GET$` | item → avatar HANDS |
| `PUT$` | item → avatar slot or region |
| `GRABFROM$` | item transfers between avatar hands |
| `THROW$` | item → region at (x, y), orientation LSB cleared |
| `WEAR$` | item → avatar HEAD slot |
| `REMOVE$` | item → avatar HANDS from HEAD |
| `OPEN$` / `CLOSE$` | door open_flags |
| `OPENCONTAINER$` / `CLOSECONTAINER$` | container open_flags; purge contents on close |
| `CHANGE$` | object orientation (changomatic) |
| `SEXCHANGE$` | avatar body-type bit toggle |
| `ROLL$` | die/game-piece gr_state |
| `RESET$` | fake-gun gr_state reset |
| `FILL$` / `POUR$` | bottle filled + gr_state |
| `SCAN$` | sensor gr_state |
| `FIDDLE_$` | generic field poke by C64 struct offset |
| `CHANGELIGHT_$` | region lighting |
| `GOAWAY_$` | object removal |
| `make`/`HEREIS_$`/`delete`/`changeContext` | session lifecycle |

Remaining `todo` entries: `SIT$`, token-family (`PAY$`/`PAYTO$`/`PAID$`/`SELL$`), and `VSELECT$`. All other ops are either ported or explicitly marked `choreography` (animation/sound only, no state effect).

Next planned steps: replay-tested against recorded prod message streams, then run in shadow mode inside SageBot (divergence logging against the legacy tracking) before cutover.

```
npm test
```
