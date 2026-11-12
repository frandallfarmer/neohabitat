# Plan: converge our Elko fork with FUDCo upstream

**Status:** proposed 2026-11-09; Phase 0 and Phase 1 passed; **Phase 2 decided 2026-11-12: converge on upstream** (see §8). Phase 3 (ship) not started. Tracking issue: #730.

**Goal:** stop carrying a long-lived divergent Elko fork. Get back to consuming something very
close to `FUDCo/Elko` master, and send our genuine fixes upstream as PRs instead of hoarding
them on a branch. The prize is that future upstream work (Chip is active) becomes a cheap pull
rather than a merge archaeology project.

---

## 1. Where we actually are

```
FUDCo/Elko  master @ 0475c93          <- upstream, active
    |
    +-- frandallfarmer/Elko master     <- diverged; carries upstream-synced copies
    |
    +-- frandallfarmer/Elko fix/persist-container-open-state
            @ 94c6db64fe              <- WHAT pom.xml CONSUMES
                |
                +-- fix/delete-removes-stored-object @ 1b9a753   <- new, built, unmerged
```

`pom.xml` pins `com.github.frandallfarmer:Elko:94c6db64fe` via jitpack.

- Upstream has **19 non-merge commits** our consumed line lacks.
- Our line has **26 commits** upstream lacks — but most are not really ours any more (below).
- Merge base is `cc1dc09`, which is *old*. This is a long divergence.

## 2. The key discovery: most of our divergence is already dead weight

**~10 of our 26 commits are already upstream under different shas**, because Chip
cherry-picked/rebased them when he merged our PRs. Same change, different commit id:

| Ours | Upstream | Subject |
|---|---|---|
| `3aca28b` | `f31f78b` | Persist container open/closed state at transition time |
| `b17823a` | `61c78f4` | Load contents based on container base ref, not container ref |
| `d25631f` | `cd11274` | Notify object completion watchers when an item is loaded |
| `eda5a54` | `fb2e527` | Changes to support opening and closing containers |
| `4cc3d93` | `3eb7ba8` | Utility classes to store maps as static objects |
| `6bade7f` | `2beac1d` | Fix User contents visibility to other users |
| `de5ce7d` | `baa57d5` | Phase 1 of MongoDB API 2.x deprecation |
| `540fa10` | `99a3fa7` | Fix compilation problem in prior PR |
| `b05c4d9` | `6a90a0d` | Fix failure to persist & load user contents |
| `405f237` | `06cc917` | Add missing javadoc comment |

**These should simply be dropped.** They are the reason the fork *looks* far ahead when it
mostly is not.

## 3. The one real fork: the MongoDB driver

This is the whole substance of the divergence, and the two lines chose opposite strategies.

| | Our line | Upstream |
|---|---|---|
| Driver API | **Modern** — `MongoCollection`, `Document`, `replaceOne` | **Legacy** — `DBCollection`, `DBObject`, `WriteResult` |
| Mongo 8 story | not addressed | `9c6d352` "Support MongoDB 8 with the current legacy Java driver", plus `d44f451` compat options |
| Write semantics | `replaceOne(..., upsert)` | `collection.update(query, wholeDoc, true, false)` |

Our modern-driver migration is the messy part of our history — `15323e6`, two reverts, a
re-apply (`044c8dd`), `7ff0284`, `df94085`, `6e9afd8`, two "working through JSONObject serde
issues" commits, then `94c6db6`.

**Crucially: `7ff0284` "Wrap update/upsert operations in set call" is the commit that CREATED
the haunted-container bug**, and `94c6db6` is purely its antidote. Both exist only because of
our migration. Upstream never had either.

### Verified: converging does NOT reintroduce the $set hazard

I checked upstream's `doPut`:

```java
collection.update(query, objectToWrite, true, false);
```

`objectToWrite` is a whole document, not a `$set` wrapper, so the legacy call is a full
replacement — the semantics Elko's omit-empty encoders require. Upstream is safe on the exact
hazard documented in the `elko-dependency-chain` notes. **This is what makes the plan viable.**

**Therefore the entire mongo-driver series can be dropped** in favour of upstream's approach.
That collapses our fork to essentially nothing.

## 4. What is genuinely ours and must survive

| Commit | Subject | Disposition |
|---|---|---|
| `1b9a753` | Persist object deletion at delete time | **Carry + upstream it.** Verified absent from `fudco/master` (`Item.delete()` there is still the unfixed version). Lives in `ServerCore/.../context/Item.java`, which is driver-agnostic, so it ports cleanly either way. |
| `4bcf7b9` | Connect/request timeout settings on MongoObjectStore | **Evaluate.** May be ours-only and worth upstreaming, but it was written against the modern API and will need porting to legacy. |

## 5. Phases

Each phase ends at a gate. Do not start the next until the gate passes.

### Phase 0 — Upstream the delete fix (do this first, independent of everything else)
1. Branch from `fudco/master`, cherry-pick `1b9a753`, resolve for the legacy-API context
   (should be a clean pick — the change is in `Item.java`, not the mongo store).
2. Build (`docker run maven:3.8-openjdk-8`; install **only `make`** — `git` is already in that
   image and asking apt for the `git` package 404s on the rotated deb11 pool).
3. Open a PR to `FUDCo/Elko`. Chip has accepted this kind of fix before (PR #4).

**Gate:** the PR builds. Merge is Chip's call and we do not block on it — we can carry the
commit locally meanwhile.

### Phase 1 — Prove upstream works for us, without committing to it
1. Branch `eval/upstream-converge` from `fudco/master`; cherry-pick `1b9a753` only.
2. Build the jar.
3. Prime jitpack for that sha; point a **local** `pom.xml` at it; `docker compose build neohabitat`.
4. Run the full local dev stack against **MongoDB 7** (what prod runs) and exercise:
   - login, region entry, avatar contents loading
   - container open/close (the `f31f78b` path) — confirm no haunted containers
   - mail end to end: compose, PSENDMAIL, receive, read, and **confirm the deleted Paper's row
     is gone from mongo** (the Phase 0 fix)
   - the four habibots, including the Oracle's Discord round trip

**Gate:** all of the above pass on Mongo 7 with upstream's legacy driver. **This is the real
risk gate** — we are swapping driver strategy, and prod data is live.

### Phase 2 — Decide and converge
- If Phase 1 passes: make `eval/upstream-converge` the new live line, abandon
  `fix/persist-container-open-state`, drop all 26 commits except `1b9a753`.
- If Phase 1 fails: stay on our line, rebase it onto `fudco/master` instead, and keep only the
  minimum mongo commits needed. Record *why* in this document.

**Gate:** a written decision, in this file.

### Phase 3 — Ship
1. Prime jitpack for the final sha; bump `pom.xml`.
2. Backup prod mongo (`~/backups/elko-<ts>.archive.gz`).
3. Deploy during a quiet window — **merging to master auto-deploys**, so this needs Randy's
   explicit go-ahead.
4. Verify: bots reconnect, no haunted containers, mail round-trips, deleted Paper rows vanish.

## 6. Risks

| Risk | Mitigation |
|---|---|
| **Driver swap breaks persistence in a way tests miss.** Highest risk; persistence bugs here have historically been silent and data-shaped (haunted containers; resurrected objects). | Phase 1 against Mongo 7 with explicit mongo-document assertions, not just "it seemed to work". Fresh backup before any deploy. |
| Upstream's legacy driver misbehaves on Mongo 7 (its new work targets Mongo 8) | Phase 1 gate is specifically Mongo 7. If it only works on 8, that turns this into a Mongo upgrade project too — stop and re-scope. |
| Losing an ours-only fix during the drop | §4 is the allow-list. Re-derive it with `git log --no-merges fudco/master..HEAD` before dropping anything, and diff file-by-file rather than trusting commit subjects. |
| Jitpack flakiness mid-deploy | Prime and confirm `status ok` *before* bumping `pom.xml`. |
| Prod already carries damage the fix won't undo | Resurrected husk rows (4 avatars: vatty, lena, ash, oracle) predate the fix and need a separate cleanup pass. |

## 7. Explicitly out of scope

- Upgrading prod MongoDB 7 → 8. Upstream enables it; we are not doing it in the same change.
- Our own `master` branch on the fork. It is stale and confusing; delete or reset it to track
  upstream once Phase 2 lands, as a separate tidy-up.

---

## 8. Phase 2 decision (2026-11-12)

**Decision: converge on upstream.** The live Elko line is now FUDCo/Elko master plus our one
genuine fix, not our modern-driver fork. `fix/persist-container-open-state` (and the whole
mongo-driver series on it) is abandoned; it stays on the fork untouched for rollback.

| | Value |
|---|---|
| New live line | `frandallfarmer/Elko` branch `upstream-converge` @ `daaff50d62` |
| Contents | `fudco/master` `0475c93` + `14c1c25` (delete-on-delete, the `1b9a753` fix re-picked onto upstream) + `daaff50` (`jitpack.yml`, JDK 17) |
| Upstream PR source | `frandallfarmer/Elko` branch `upstream/delete-on-delete` @ `14c1c25` (PR to FUDCo/Elko not yet opened) |
| NeoHabitat change | `pom.xml` only: pin `com.github.frandallfarmer:Elko:daaff50d62`, drop `org.mongodb:mongodb-driver` 3.12.14 (upstream brings `mongodb-driver-legacy` 5.13.0 transitively). No Java changes. |

### Phase 1 evidence (summary)

Run locally on 2026-11-12 against MongoDB 7.0.48 (what prod runs), natively and in the Docker
dev stack, on a fresh schema load **and** on data written by the current line (`94c6db64fe`).
The server was SIGKILLed between steps, so nothing relied on a clean shutdown.
229/230 assertions passed; the one miss was a harness assertion error (server picks the slot),
fixed, and every later run passed.

- **Containers:** open/closed state survives hard restarts; a second user sees the right
  contents. Upstream's `collection.update(q, wholeDoc, upsert)` is a full replace, so an omitted
  `closed` key really is removed. No haunted containers; the `7ff0284`/`94c6db6` series is not needed.
- **Mail and deletes:** compose → PSENDMAIL → receive → READ works end to end, including a letter
  sent by the old jar and read by the new one. The sent Paper's document is gone from Mongo
  immediately. On the old jar the same crash window resurrects the sheet in the sender's HANDS,
  which is exactly the production husk.
- **Data compatibility:** on identical scenarios the two jars sent byte-identical object
  messages (558 `make`s across 41 containers, 0 differences) and wrote 25,217 identical documents
  (field order and BSON types included).
- **Everything else:** create/move/get/put across restart, Bureaucrat (NeoHabitat's own Mongo
  client) on driver 5.13, eliza and hatchery/welcomebot, Telko, and all repo suites
  (Go vet/test -race, webclient 23/23, habiworld 152/152, habibots 64/64) pass.

Full report: kept outside the repo (`elko-phase1/REPORT.md` on the build box).

### Corrections to this plan found during Phases 0–2

- **Java 17, not 8.** Upstream's pom compiles with `<release>17</release>`, so the Phase 0
  "build with `maven:3.8-openjdk-8`" step is stale. JitPack defaults to JDK 8 and fails with
  "invalid target release: 17", so the live line carries a `jitpack.yml` pinning `openjdk17`.
  NeoHabitat's runtime is Java 21, which is fine.
- **`4bcf7b9` (Mongo timeouts) is not a carry candidate.** It was already undone in our own line
  in 2017; prod has always run on driver defaults. Nothing to port.
- **The allow-list (§4) is just `1b9a753`.** Of the 10 "already upstream" commits in §2, 8 are
  identical and 2 differ but carry nothing we need.
- **The delete bug is narrower than first described.** `Item.setContainer(null)` makes the
  deleted item a codependent of its former container, so on the old jar the delete *is* written
  the next time that container (e.g. the avatar) is checkpointed. It is lost only if the server
  stops first (crash, deploy restart, OOM, SIGKILL). The fix closes that window.
- **Credit:** the modern mongo-driver series on our line was written by Frank Reynolds, not Randy.

### Still untested (carry into Phase 3 verification)

- The Oracle bot and its Discord round trip (needs Discord tokens).
- Sage (needs `ANTHROPIC_API_KEY`).
- A real C64 client (no VICE on the build box).
- MongoDB 8 (out of scope per §7; prod is on 7).

### Still to do outside this change

- **Prod cleanup of resurrected husk rows** (vatty, lena, ash, oracle). The fix prevents new
  husks but does not remove existing ones; they load faithfully under the new jar.
- Phase 3 as written: confirm jitpack `status ok` for `daaff50d62` (primed in Phase 2, before the pom
  bump), **back up prod mongo**, then merge only on Randy's explicit go-ahead, since merging to
  master auto-deploys.
