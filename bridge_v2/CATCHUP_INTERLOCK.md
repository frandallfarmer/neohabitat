# Catch-up interlock (avatar "transit invisibility")

## What it is

When an avatar is **transiting** — changing regions and still loading the new region's contents
vector — it must be **invisible and non-interactive on every screen** until it has caught up. The
original Habitat client implements this with the `avatar_on_hold` bit (`Main/equates.m`,
`0b01000000`); `render.m` render-skips any avatar with that bit set, and `actions.m` clears it on
`APPEARING_$` ("OK!!! DRAW ME!").

This prevents a fast client from drawing or interacting with an avatar that hasn't finished
loading — important when a slow real C64 is co-present with the JS webclient.

## The original (Stratus PL/1) design — the canon

On the Stratus host (`habitat-orig/sources/stratus`):

- `Processes/regionproc.pl1` — in the **region-change handler**, just before the avatar's
  descriptor is serialized for the new region: `if (my_noid ^= GHOST) then set_bit(gr_state, 7)`
  (`bits(7)` = `0x40`). **Ghosts are exempt.** The bit rides along on the avatar's carried state
  into the new region's contents vector, so everyone there sees it held.
- `Classes/class_region.pl1` — `region_I_AM_HERE` does `clear_bit(gr_state, 7)` and broadcasts
  `APPEARING_$`; `region_FINGER_IN_QUE` replies `CAUGHT_UP_$`.

So the bit is set **at the transit**, on the avatar's wire state, and cleared **when it appears**.

## The neohabitat bug this fixes

The elko (Java) server faithfully ports the *clear* half — `Region.I_AM_HERE` does
`gr_state &= ~INVISIBLE` + broadcasts `APPEARING_$` — but **nothing ever set the bit**. So arrivals
just popped in mid-load on every client. The "invisible stuff" was always supposed to be there.

## Why the fix lives in the bridge, not elko

elko changes regions as **make/break** (tear down the old context, stand up a new one).
`bridge_v2`'s job is to hide that seam and present the client one continuous session — which makes
the bridge the exact elko-era analog of the Stratus `change_region` coordinator. So the bridge sets
the bit **purely on the wire**, toward the client; **elko and its DB never see it** (no
`src/main/java` changes). It's pure presentation state, which is what it is.

## How it works (`bridge_v2/bridge/invisible.go` + `client_session.go` + `server_ops.go`)

Transiting is a property of the **avatar**, not of a connection (the bridge holds avatar state
across elko's per-region make/break, and `Bridge.Sessions` is keyed by socket address, not avatar).
So it lives in a **global per-avatar latch**, `transitRegistry` (ref → bool, mutex-guarded):

- **mark** on `enterContext` (a region change), keyed by the stable short user-ref (`user-randy`).
- **clear** on the avatar's **own `APPEARING_$`** (matched by its own noid). *Not* on `ready` —
  `ready` fires before the cross-session broadcast of the arrival make reaches other sessions, so
  the latch would already be gone when they check it.
- **clear immediately when transiting *as a ghost*** — the `you:true` make is a `Ghost` (noid 255),
  and a ghost skips the `I_AM_HERE → APPEARING_$` handshake ("free up cursor NOW, I am a ghost!"),
  so no `APPEARING_$` ever comes; without this the latch goes stale and a later in-region deghost
  is wrongly held. (Ghosts are also never themselves held — they're not `Avatar`-typed makes.)
- **clear on `Close()`** defensively, so a session dying mid-transit can't strand an avatar.

Any session, when forwarding an avatar make, consults the registry and — if that avatar is
transiting — sets the on-hold bit:

- **C64 / binary path:** `holdAvatarMod(mod)` mutates the parsed mod; the make is re-encoded from it.
- **webclient / JSON path:** `holdAvatarRaw(raw, mod)` patches the single `"gr_state":N` in the raw
  elko bytes (that path forwards raw, so a struct change isn't enough).

### Release, client-side

The hold is released by `APPEARING_$`, which the bridge does **not** alter:

- C64 clears `avatar_on_hold` natively (`actions.m`).
- The JS webclient clears it in `habiworld/lib/behaviors/avatar_choreography_host.js`
  (`region_APPEARING`), and `webclient/lib/world-adapter.js` skips any `Avatar` with `gr_state & 0x40`
  from both render and pick.

### CORPORATE (deghost) is *not* a transit

A deghost re-makes the corporeal avatar **in place** — it never calls `enterContext`, so it's never
marked, so its make is never held. That's the same distinction Stratus drew by setting the bit only
in the `change_region` handler.

## Related: outbound pacing

`webclient/lib/transport.js` also paces outbound messages to an effective **600 baud** (leaky
bucket; isolated messages immediate, bursts throttled), so a webclient can't outrun a co-present
C64's serial buffer. `?baud=0` disables.
