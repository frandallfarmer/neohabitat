Habibots
========

The [Neohabitat Project](http://neohabitat.org) has resurrected the world's first
graphical MMO, [Lucasfilm's Habitat](https://en.wikipedia.org/wiki/Habitat_(video_game)).
While developing it we wrote a bunch of in-world bots to test features, and packaged
the useful bits into this framework so you can rapidly write bots of your own.

Habibots lives inside the main neohabitat repo at
[`habibots/`](https://github.com/frandallfarmer/neohabitat/tree/master/habibots).
The previous standalone home at `github.com/ssalevan/habibots` was migrated here
in 2022 and is no longer maintained — open issues and PRs against the neohabitat
repo instead.

Running with the rest of the stack
----------------------------------

The bots ship as part of `docker compose`. From the repo root:

```sh
docker compose up -d bots
```

This brings up the `bots` service defined in `docker-compose.yml`, which
runs `hatchery`, `eliza`, `sage` and `oracle` against the local
elko/bridge. `sage` and `oracle` each skip their own launch when their
credentials are unset, so the rest of the lineup still comes up.

The Oracle bot
--------------

`bots/oracle.js` closes the loop on `#oracle-requests`. When an avatar
ASKs a fountain (or WISHes on a magic lamp), `bridge_v2` posts it to
Discord; an Oracle right-clicks that message → Apps → **Answer as the
Oracle**, types a reply, and this bot mails it to the asker in-world.

Mail rather than speech because the asker is usually logged out by then,
and mail is the one thing that waits for them.

It needs a real bot account — a webhook can post but cannot read or
reply — with **View Channel**, **Send Messages** and **Read Message
History** on that channel. No privileged intents: the context-menu
command hands us the message we need, so the bot never sees the text of
anything nobody pointed it at.

Set `DISCORD_BOT_TOKEN`, `DISCORD_ORACLE_GUILD_ID` and
`DISCORD_ORACLE_CHANNEL_ID` (optionally `DISCORD_ORACLE_ROLE_ID` to
restrict who may answer) — see `.env.example`. It also needs the
`user-oracle` avatar from `db/Users/user-oracle.json`, whose Paper in
`MAIL_SLOT` is load-bearing: without it, mail sent *to* the Oracle is
destroyed after the sender is told it succeeded.

### Why the Oracle is unreachable in-world

Players should meet the Oracle only through an oracular object, never as
a resident. Two things arrange that:

- It carries the **`HIDDEN_AVATAR`** nitty_bit (`Constants.java`), which
  keeps it out of `Region.NameToUser`. That one table backs the F3 user
  list, `/online` counts, ESP targeting, `/join`, `/invite`, `/teleport`,
  `/yank` and `tellEveryone`, so all of them skip it at once. ESP answers
  `"Cannot contact oracle."` Mail sent *to* it takes the offline branch
  and queues at `mail-oracle` in mongo, which is where a future version
  will read player replies from.
- It lives in **`context-oraclehome`** (`db/Backroom/`): floor, wall, and
  a sign reading "Entry Forbidden". No exits, no neighbours, no teleport
  address, and `is_turf` deliberately unset so it can never be handed to
  a new player as their turf.

### Installing the Oracle on an existing server

`make db` runs `nuke` first, so it must never be pointed at a live server.
Use the one-shot migration instead, which touches only the seven records
this feature introduces and deletes nothing:

```sh
cd db
node patchOracleHome.js --url=//127.0.0.1:27017/elko            # dry run
node patchOracleHome.js --url=//127.0.0.1:27017/elko --apply    # commit
```

It is safe to re-run: existing records are left alone unless `--force`. It
will not re-add `item-oracle.paper` once the Oracle owns a sheet under
another ref — mailing destroys the sheet you send and `special_get` mints
the replacement as `i-<id>`, so re-seeding would leave two Papers in
MAIL_SLOT. It also warns if any region has come to list `context-oraclehome`
as a neighbour, or a teleport address points at it.

The elko image must already carry `HIDDEN_AVATAR` when this runs; if the
image lags, the Oracle shows up in everyone's F3 until it catches up.

### Letters addressed to the Oracle

A player can write `to: oracle` on a Paper and mail it. Because the Oracle
is hidden, `getUserByName` misses and `Paper.sendMailToUser` always takes
the offline branch, so the letter queues at `mail-oracle` and lands in the
bot's MAIL_SLOT on its next `check_mail`. The bot reads it out and posts it
to `#oracle-requests` with a ✉️ — the same shape the bridge uses for a
fountain ASK, footer included, so an Oracle answers a letter with exactly
the same right-click command.

Draining is not optional. `MAIL_SLOT` is the only self-replenishing paper
source (`Paper.GET`'s `special_get` fires only for that slot; a numbered
pocket slot is single-use), and a blank sheet is refused if the slot holds
unread mail — so one letter would otherwise leave the Oracle unable to
answer anyone, permanently. After reading, the sheet is blanked and put
back in a pocket, which makes the server destroy it (`Paper.java:334`),
leaving exactly one Paper in the slot.

### Nothing may be left in the hands

`Paper.GET` is gated on `empty_handed(avatar)`, so a single page stranded in
HANDS disables the Oracle in **both** directions — it can neither collect a
letter nor pick up a blank sheet to answer one — and every symptom downstream
presents as "the letter read back empty" instead of "the hands are full".
Production, 2026-09-02: an elko-side EOF interrupted a collection, a letter sat
in the Oracle's hands for sixteen hours, and the bot looped every two minutes
doing nothing and logging nothing.

So every mail check starts by clearing the hands, along this ladder:

1. **Blank sheet** — fine as it is, use it.
2. **Readable page with a postmark, or anything that arrived as a `LETTER`** —
   somebody else wrote it. Relay it to Discord *first*, then dispose of it.
3. **Readable page with no postmark and `WRITTEN` state** — our own abandoned
   draft. Blank it and put it away, which destroys it.
4. **Unreadable** — retried across several checks first, because elko loads
   letter bodies asynchronously and one empty read proves nothing. A page still
   unreadable minutes later has a `text_path` pointing at a document that no
   longer exists. It is moved **intact** into a free pocket slot (never blanked
   first — `Paper.PUT` destroys only a sheet that is already blank), the hands
   come free, and the channel is told once.

Step 4 ends with a **region re-entry**, and that part is not optional.
`generic_PUT` announces the move with `send_neighbor_msg`, which excludes the
actor, so the bot cannot see its own `PUT` any more than it can see its own
`GET`: elko has the page in a pocket while the world model still shows it in
hand. Without the refresh the next check finds the same "blocked" hands and sets
the page aside again on every pass, never reaching the mail — which is exactly
what the first deployment of this fix did.

Destroying an unread page is not on the ladder. A `WRITTEN` page in hand is
genuinely ambiguous, because `Paper.GET` fiddles an incoming letter to `WRITTEN`
as you pick it up, so "written must mean my own draft" would erase real mail.

It is **not** a ghost, though that looks like the obvious answer. A ghost
cannot mail: `HabitatMod.objectIsComplete` skips `Region.addToNoids` when
the container is a ghost avatar, so a ghost's pocket Paper is never
materialised — measured live, a ghost logs in with noid 255 and an empty
inventory, and there is no Paper to pick up.

Point a dev instance at a **test** Discord server. Aiming it at
themade.org's would answer live players.

Running standalone
------------------

```sh
cd habibots
npm install
./run greeter1     # or hatchery, eliza, oracle, etc. — see bots/
```

The launcher reads `HABIBOTS_HOST` and `HABIBOTS_PORT` from the environment
(defaults: `127.0.0.1:1337`).

**Windows 10/11 users**: run inside WSL2. If `./run` complains about CRLF
line endings, `dos2unix run`.

Writing a Habibot
-----------------

A Habibot is a Node module under `bots/` that imports `habibot.js` and
implements an event handler. Look at `bots/eliza.js` for the simplest
example, or `bots/hatchery.js` for one that drives a context and reacts
to other avatars.
