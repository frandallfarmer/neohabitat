# Telko Handler Extensions

## Overview

Telko scripts (`.elko` files) are sequential streams of outgoing JSON messages.
This extension adds two handler syntaxes for reacting to incoming messages:

- `?OP` — **reply handler**: "wait for" — pauses script until a matching message satisfying the condition arrives
- `@OP` — **async handler**: persistent, fires whenever a matching message arrives

---

## Syntax

### Outgoing message (existing)
```
{"op":"WALK","to":"$ME","x":100,"y":130}
```

### Inline code
```
> javascript expression or function definition
```

Scheduled to execute after all preceding sends have fired (at `timeLastSent`).
Definitions accumulate in a shared scope visible to all subsequent `?` and `@`
handler blocks. Use `>` to read state that is guaranteed to be populated by
the time the preceding sends have completed.

### Reply handler
```
?OP [$TARGET]
(> javascript code)
```

Registered after all preceding sends have fired. Means: **wait for an incoming
OP that satisfies this condition**, then run the code and advance the script.

The code block is evaluated as an expression. If it returns falsy, the handler
stays pending — waiting for the *next* matching message. If it returns truthy,
or is a statement with no return value, the script advances.

```
?make *
(> last.you)
```

"Wait for a `make` where `last.you` is true." All other makes are ignored.

```
?WALK$
(> if (last.err !== 0) abort('walk failed: err=' + last.err))
```

"Wait for `WALK$`, then abort if it failed." Statement form — always advances.

### Async handler
```
@OP [$TARGET]
(> javascript code)
```

Registered after all preceding sends have fired. Does NOT pause the script.
Fires whenever a matching incoming message arrives. A later `@OP $TARGET` for
the same op+noid key replaces the earlier one.

---

## Sequencing

`>` lines and `@` handler registrations are **scheduled at `timeLastSent`** —
the moment the last preceding send fires — not at script parse time. This
means:

- Sends from preceding lines execute first
- `>` code sees state (History, Names) populated by those sends and any server
  responses that arrived during the send delays
- `@` handlers start listening from that point forward

`?` handler registration is synchronous (it must pause the script immediately),
but the `?` is resolved using `Names` at registration time, which is after all
preceding sends have fired.

---

## Target resolution

`$TARGET` is optional. If omitted it defaults to the noid of the `to` field
of the most recently sent message.

`$TARGET` is resolved through `Names` at the moment the handler is registered —
after preceding sends have fired and `Names` is populated.

Special targets:
- `$ME`     — noid of the current user's avatar
- `$REGION` — noid of the current region (useful for broadcasts)
- `$TARGET` — noid of the most recent send's `to` field (default)
- `$chip`   — any Names entry, resolved at registration time
- `*`       — wildcard: matches any noid for this op

The handler map key is `op + ':' + resolvedNoid`. Last write wins per key.

---

## Code block context

`>` lines, `?` handler blocks, and `@` handler blocks all share a single scope.
Functions and variables defined with `>` are available to all subsequent handlers.

| Name              | Description                                      |
|-------------------|--------------------------------------------------|
| `last`            | Parsed incoming message that triggered this handler |
| `Names`           | Short-name → full ref lookup table               |
| `History`         | Full object state (keyed by ref)                 |
| `Telko`           | Config object (delay, logtime, etc.)             |
| `send(obj)`       | Queue an outgoing message                        |
| `abort('reason')` | Stop script execution, log reason and exit       |
| `ignore()`        | Deregister this `@` handler (no-op inside `?`)   |

---

## Script pause semantics

When a `?` handler is registered:
- The script **stops advancing** to the next line
- `@` handlers remain **fully active** and may fire and call `send()` freely
- Each matching incoming message is tested against the condition code
- When the condition is satisfied (truthy return, or statement with no return),
  the script resumes from the next line
- Non-matching messages (condition returns falsy) are silently skipped — the
  `?` keeps waiting

If `abort()` is called inside a `?` or `@` block, the script halts immediately
with an optional exit message. Pending `?` and all `@` handlers are cleared.

---

## Examples

### Wait for avatar before proceeding (standard login guard)
```
{"to":"session","op":"entercontext","user":"user-randy","Telko":{"delay":2}}

?make *
(> last.you)

{"to":"ME","op":"POSTURE","pose":141}
{"to":"ME","op":"SPEAK","esp":0,"text":"$ME.name$: Greetings Programs!"}
```

The `?make *` stays pending through all region/item makes until the avatar make
(`you: true`) arrives, guaranteeing `$ME` and `History[Names['ME']]` are set
before any subsequent sends or `>` lines run.

### Dump avatar state after login
```
{"to":"session","op":"entercontext","user":"user-randy","Telko":{"delay":2}}

?make *
(> last.you)

> console.log(JSON.stringify(History[Names['ME']], null, 2))
```

With the guard in place, the `>` line fires at `timeLastSent` (after the sends),
and `Names['ME']` is guaranteed to be populated.

### Walk and confirm
```
{"op":"WALK","to":"$ME","x":100,"y":130}
?WALK$
(> if (last.err !== 0) abort('walk failed: err=' + last.err))
{"op":"SPEAK","to":"$ME","text":"Made it!"}
```

### Define helpers, react to speech
```
> function greet(name) { send({"op":"SPEAK","to":"$ME","text":"Howdy, " + name + "!"}) }
> function isBot(name) { return name.toLowerCase().includes('bot') }

@APPEARING_$ $REGION
(> if (!isBot(last.obj.name)) greet(last.obj.name))

@SPEAK$ $REGION
(> if (last.text.includes('help')) greet(last.text.split(' ')[0]))
```

### Replace a handler mid-script
```
@SPEAK$ $chip
(> log('chip said: ' + last.text))

{"op":"WALK","to":"$ME","x":50}
?WALK$
(> )

@SPEAK$ $chip
(> if (last.text.includes('bye')) { send({"op":"SPEAK","to":"$ME","text":"See ya!"}); ignore() })
```

### One-shot async: greet first avatar then stop
```
> function greet(name) { send({"op":"SPEAK","to":"$ME","text":"Welcome, " + name + "!"}) }

@APPEARING_$ $REGION
(> greet(last.obj.name); ignore())
```

### Wait for a door to open (broadcast to region, not to sender)
```
{"op":"OPEN","to":"$door"}
?OPENED_$ $REGION
(> log('door is open'))
{"op":"WALK","to":"$ME","x":100}
```

---

## Implementation notes

- Shared scope: a plain object accumulates all `>` definitions; spread as named
  parameters into every handler function via `new Function`
- `>` lines and `@` registrations are deferred via `setTimeout` to `timeLastSent`
- `?` registration is synchronous (must pause the script before the next line runs)
- `?` code is evaluated as `return (code)` first; if that is a syntax error
  (statement rather than expression), it falls back to running as a statement
  and always advances
- `@` map: plain object, key = `"OP:noid"`, value = compiled function
- `?` slot: single pending handler (op, noid, code); only one active at a time
- `send()` inside handlers uses the same queue as the script — no special path
- Incoming messages first check `?` slot, then `@` map (exact key, then `op:*`
  wildcard), then discard
