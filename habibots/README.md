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
runs `hatchery` and `eliza` against the local elko/bridge.

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
