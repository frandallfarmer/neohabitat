# U64 split-document page corruption — investigation handoff

**Audience:** Steve Salevan (U64 client / serial-over-network delivery layer)
**From:** bridge_v2 investigation, 2026-07-03/04
**Status:** open. Two bridge-side QLink fixes shipped and validated (below); the
on-screen corruption is **not** a bridge-protocol bug and reproduces only on the
U64. This document hands the remaining problem to the U64/C64 side with all the
evidence, the constraints, and a test harness you can drive.

---

## 1. TL;DR

Reading a paginated document (the in-world "RANT" book) on real C64 hardware
behind a **U64** produces a **garbled page**: paragraph-indent lines gain extra
leading spaces, the layout shifts, the page-number line at the bottom
disappears, and the client sometimes **hangs**. The **same page** renders
**perfectly** in the VICE emulator and in the web client. It only breaks on the
U64, and only under the heavy packet loss / retransmission that the U64's link
exhibits.

We have proven, three independent ways, that **the bytes are correct all the way
down to the QLink wire**:

1. The document in the DB is a clean 16×40 page (640 bytes), indents included.
2. The exact bytes the bridge queued for the failing read are **byte-identical**
   to the DB (diffed from prod logs).
3. A closed-loop simulation that models the C64 receiver faithfully and drives
   the **real** bridge send + retransmit through a lossy channel reassembles
   every page **byte-exact** at 10–60% loss, including across the sequence wrap.

So the corruption is introduced **below the QLink protocol** — in the path that
moves bytes from the network, through the U64, into the C64's 6551/userport, and
in what the C64 does with them while it is busy rendering. That's your layer.

---

## 2. The symptom, precisely

Test case: in-world region `context-Downtown_9j` (the City library) has a book
`item-book.0999.Downtown_9j` = "The Rant - Volume 2 - Number 10". The document is
`db/Text/text-03231988-rant-vol2-no10.json`. Page 9 (index 8, "TRIAL EXPECTED IN
COURTROOM") is the reference case; page 8 ("HERMIT/REVOLUTIONARY SUES ORACLE")
shows the same thing.

Each page is exactly **640 bytes = 16 rows × 40 columns**, space-padded, with a
handful of C64 box-drawing control bytes (0x0D, 0x1B, 0x1C, 0x0E/0x0F, 0x10-0x16)
and **genuine 3-space paragraph indents** in the source (before "Asked to
comment" and before "He obviously"). A correct renderer shows those indents —
the emulator does (see below).

On the U64, under load, the observed corruption was:

- extra leading whitespace on the paragraph lines (indents grew beyond the
  source's 3 spaces), i.e. content shifted right;
- the bottom border row and the centered page-number ("9") pushed out of place /
  off-screen ("I see an extra space on line 14" — line 14 is the box's bottom
  border row);
- on some reads the client **hung** (no further paging; eventually reset).

Reference renders:

- **VICE emulator, clean TCP link:** page 9 renders **perfectly**, indents and
  page number correct.
- **Web client:** had a *separate* bug (it dropped leading spaces in its canvas
  renderer) — that one is **fixed** and is not related to the U64 issue.

Conclusion from the reference renders: given the correct bytes at a normal pace,
the C64 client renders this page correctly. The U64 differs only in the
**delivery timing and loss** of those bytes.

---

## 3. What has been ruled OUT (with evidence)

### 3a. The document data is correct
`db/Text/…rant-vol2-no10.json` page 9 laid out at 40 columns is a clean 16×40
grid. The "extra" indents people see are partly **real** (3-space paragraph
indents in the source) — a correct render keeps them.

### 3b. The bytes the bridge queued are correct
From the prod journal (`journalctl -u bridge_v2`), the `->CLIENT` buffer the
bridge assembled for the failing read was captured and **diffed byte-for-byte**
against the DB page: **640 bytes, zero differences.** The bridge does not insert,
drop, or reorder any page byte at assembly time.

### 3c. The bridge's split + retransmit protocol is correct
See §7 (the simulation). A faithful C64-receiver model + the **real** bridge
send/retransmit, driven through a seeded lossy channel, reassembles every page
byte-exact across 10–60% loss and across the sequence wrap. If the bridge could
deliver duplicated/dropped/reordered chunks under loss, this test would catch it.
It doesn't.

### 3d. The C64 render logic is correct
The emulator (identical client ROM, clean link) renders the page perfectly. So
the client's document renderer (`Main/text_handler.m`) is not the bug in
isolation; it misbehaves only under the U64's delivery conditions.

**Net:** the fault is in the **U64 byte-delivery / C64-under-load** layer, not in
the document, the bridge assembly, the QLink protocol, or the client renderer in
the abstract.

---

## 4. Two bridge-side fixes already shipped (context, not the U64 fix)

These fixed *different* QLink bugs the same U64 session exposed. They are on prod
and validated live. They are relevant because they change the retransmit
behavior you'll observe, and because they shrank (but did not eliminate) the
retransmit storm.

1. **Corrupt frames are now NAKed and discarded, never processed**
   (`qlink_codec.go`, `qlink_session.go`). Previously a bad-CRC frame was logged
   "CRC mismatch ignored" and then *processed*, so its garbage RecvSeq/SendSeq
   poisoned the ack window. This matches the C64's own `mikes_protocol.m`
   `bad_pkt` (snd_NAK + discard).

2. **A NAK's RecvSeq never frees the retransmit window** (`qlink_session.go`
   `qlinkProcessAck`). The C64 sends NAKs from its pre-built `quick_buf`, so a
   NAK's piggybacked RXSQ can lag the true cumulative ack badly (seen live: NAK
   carried 85 while heartbeats said 100+). The old code treated that stale value
   as a wrapped ack and freed un-received chunks → the split document livelocked
   and the client reset. Now only forward-moving heartbeat acks free the window.

**Important for you:** Snog's corruption reports came **after** both fixes were
deployed. So the on-screen garble is independent of these — it is the U64 layer.

---

## 5. C64-side constraints you must design against (`Main/protocol.m`, `Main/mikes_protocol.m`, `Main/comm_control.m`)

These are the places where "too many bytes, too fast, or too full" turns into
corruption or a hang on the client. All line numbers are from
`~/habitat-orig/sources/c64`.

### 5a. `RSINBF` is a **128-byte** single-frame buffer
`protocol.m` RS232I: each incoming byte is stored at `RSINBF[COUNT]`; if
`COUNT` reaches 128 the sign bit trips and it branches to `p_bad_packet` →
`NAKSND` (protocol.m:210-211, 223-225). A single QLink frame whose body (after
SYNC) reaches 128 bytes is rejected outright. The bridge caps `MAX_PACKET_SIZE`
at 100 payload bytes, but **escaping expands the frame**: every 0x0D or 0x5D in
the payload becomes two bytes (`ESCAPE_CHAR 0x5D` + `byte ^ 0x55`). A
bitmap-heavy or escape-heavy chunk can approach the limit. Text pages don't, but
region DESCRIBEs can. Worth confirming the U64 never *coalesces* two frames (a
lost 0x0D terminator would merge frame N + N+1 and blow past 128).

### 5b. The `super_buffer` and the `super_buffer_full` **jam** (`comm_control.m:427` `is_there_space`)
Accepted packets are copied into a **circular `super_buffer`** at
`next_avail_byte` and drained later by the dispatcher/renderer. Before a packet
is processed, `is_there_space` checks room against `next_packet` (oldest
un-drained). If there's no room it sets `super_buffer_full` and returns carry;
the caller (`protocol.m:259-262`) then **IGNOREs the packet without acking it**
(so the host retransmits). Once `super_buffer_full` is set, **every** subsequent
packet is ignored (`comm_control.m:428-429`) until the buffer drains and the flag
clears.

This is the most likely **hang** mechanism: if the render loop can't drain the
super_buffer as fast as the (retransmitting) host fills it, the buffer jams, the
client NAKs/ignores everything, the host resends, and if the renderer never
catches up it wedges. It is also a candidate **corruption** mechanism: the
circular-buffer wrap math in `is_there_space` (lines 438-462, including a
self-modifying reset to `buffer_base`) is intricate; if the pointers get into a
bad state during sustained overflow, a later packet can land at the wrong offset
or over unprocessed data — which would read on screen as shifted/duplicated
bytes (extra spaces), exactly the symptom.

### 5c. Duplicate detection is robust — you can rely on it (`protocol.m:511` `INWIND`)
A DATA frame is processed only if `SendSeq == NXTSEQ`; otherwise `INWIND`
classifies it as "recent" (already received → **IGNORE**, no reprocess) or
"future" (gap → NAK). We modeled this exactly (§7) and confirmed a retransmitted
chunk the client already has is **not** double-appended. So simple
"resend caused a duplicate" is **not** the mechanism — the dedup catches it. The
corruption must come from something the dedup can't see: bytes mangled/duplicated
**within** a frame that still passes CRC (see 5d), the super_buffer jam (5b), or
render-time cycle starvation (§6).

### 5d. CRC protects the payload; Hamming protects only the CRC nibbles
The 4 CRC bytes are Hamming-encoded and single-bit-corrected on receive
(`protocol.m:214` `p_unham`); the payload is covered by CRC-16 (poly 0xA001).
So a single-bit hit on a CRC nibble is silently corrected, but any payload
corruption fails the CRC → NAK → retransmit. This is why byte-level line noise
does **not** corrupt the final page — it just drives retransmission. For
corruption to reach the screen, bytes would have to be altered in a way that
still satisfies CRC (astronomically unlikely) **or** the damage happens after
the CRC check — i.e., in the super_buffer/render stage (5b, §6).

---

## 6. Leading hypotheses, ranked

1. **RX overrun during render (NMI starvation).** The C64's userport/6551 RX is
   NMI-driven. While `text_handler.m` paints a page line, the NMI is held off; if
   the U64 feeds the next byte before the C64 reads the RX register, the byte is
   lost (overrun). A lost byte → short frame → CRC fail → NAK → retransmit. That
   alone is recoverable, but it (a) creates the retransmit storm we saw, and (b)
   the storm keeps the RX/render loop saturated so the **render itself** glitches
   or the **super_buffer jams**. This is consistent with "renders fine on the
   emulator (no bursty serial), breaks on the U64 (bursty 9600-baud feed into a
   render-busy CPU)." **Most likely.** Check the 6551 overrun status bit and how
   the NMI handler behaves under overrun; measure per-line render time vs. the
   inter-byte arrival time the U64 presents.

2. **super_buffer jam / circular-buffer corruption under sustained overflow**
   (5b). The retransmit storm delivers packets faster than the render drains
   them; the buffer fills, jams, and — if the wrap pointers desync — a packet
   lands wrong. Explains both the hang and the shifted/extra-space render.
   Instrument `next_avail_byte`, `next_packet`, `super_buffer_full`, and
   `is_there_space`'s branch during a failing read.

3. **Byte duplication at the U64 serial layer.** If the U64's network→serial
   path ever presents the same RX byte twice (NMI re-entry, double-read of the
   6551 data register), a mid-frame dup fails CRC (caught), but a dup of the
   **SYNC (0x5A)** or **terminator (0x0D)** could reframe the stream. Worth
   ruling out by capturing raw userport bytes (see §8).

4. **Timing / pacing.** The bridge paces split chunks by `qlinkChunkPacing`
   (`qlink_session.go`), currently **50 ms**, whose own comment says it "must
   exceed a chunk's ~100 ms feed time to create a real gap (else the modem just
   buffers ahead)." So the value contradicts its stated intent. Note the bridge
   also rate-limits output to ~120 B/s (`--rate=1200`), which already spaces
   chunks ~1 s apart at the bridge egress — so whether extra pacing helps depends
   entirely on **whether the U64 buffers the slow ingress and then bursts it to
   the C64 at 9600 baud**. That is a U64-side fact only you can determine. If the
   U64 does burst, raising `qlinkChunkPacing` past the real per-chunk feed time
   (and/or lowering `MAX_PACKET_SIZE` so each burst is shorter than the C64's
   render-blackout window) is the lever. This is empirically testable on your
   hardware and is the cheapest thing to try first.

---

## 7. The test harness I built (`bridge_v2/bridge/qlink_reassembly_sim_test.go`)

A **closed-loop simulation** that reproduces Snog's lossy session in a unit test.
It exists to answer "can the bridge protocol itself corrupt a page under loss?"
— and it proves the answer is **no**, which is what localized the bug to your
layer. You can extend it to model the U64/C64 stage where the bug actually lives.

**What it models (faithfully, from `protocol.m`):**
- `c64Receiver`: strict in-order accept (`SendSeq == NXTSEQ`, wrap 0x7F→0x10);
  `c64Inwind` reproduces `INWIND` exactly (recent→ignore, future→NAK); the
  128-byte oversize guard; `SPLIT_START/MIDDLE/END` reassembly.
- The **real** bridge send path (`sendQLinkHabitatAction` → escape + encode +
  window record) and the **real** retransmit (`qlinkProcessAck`, go-back-1).
- A seeded lossy channel (`math/rand`, deterministic) that drops frames; a
  dropped or CRC-corrupt frame is modeled identically (both → the C64 NAKs and
  the bridge resends).

**What it asserts (all green):**
- `TestQLinkLossyReassembly_PageIsExactAcrossLoss` — a single 7-chunk page,
  loss ∈ {0, .1, .25, .4, .6}, 20 seeds each: reassembles **byte-exact** and
  converges.
- `TestQLinkLossyReassembly_PagingAcrossSequenceWrap` — 24 pages read in
  sequence over one session (past the 0x10→0x7F wrap, the "read the whole RANT"
  case), loss ∈ {.1, .3, .5}, 10 seeds: every page byte-exact.

**Run it:**
```
cd bridge_v2
docker run --rm -v "$PWD":/src -w /src -e GOFLAGS=-buildvcs=false \
  golang:1.25 go test -run QLinkLossyReassembly ./bridge/ -v
```

**How to extend it to find the U64 bug** (this is the useful part for you):
- **Add a byte-level corruption/duplication model** between the bridge's wire
  output and `c64Receiver.receive`: randomly drop/duplicate individual *bytes*
  (not whole frames), then re-run the CRC check. This tests the hypothesis that
  the U64 mangles bytes below the frame level. Expectation: CRC catches it, page
  still exact — if it *doesn't*, you've found a reframing bug.
- **Add the super_buffer as a bounded queue** with a render-drain rate: give
  `c64Receiver` a fixed-size buffer that drains N bytes per "tick," and make
  `is_there_space` return full when it can't fit a packet (IGNORE without ack).
  Then model the render loop stealing cycles. If a fill-faster-than-drain regime
  produces a wrong reassembly or a non-converging (hung) state, that reproduces
  the jam in software and gives you a regression target.
- **Model bursty delivery + an RX register with overrun:** deliver bytes in
  9600-baud bursts with a "render blackout" window during which an arriving byte
  is *lost* (overrun) rather than buffered. This is the closest software analog
  of the real U64 failure and would let you tune `qlinkChunkPacing` /
  `MAX_PACKET_SIZE` against a repeatable model before touching hardware.

The current tests deliberately assume "CRC-good-or-dropped" (the honest model of
a correct link). The U64 bug lives in the assumptions that model makes — so the
highest-value next step is to *break* those assumptions in the sim in the
specific way the U64 hardware does, and watch it reproduce.

---

## 8. Recommended investigation order

1. **Capture ground truth at the userport.** The single most valuable datum:
   record the raw byte stream arriving at the C64's serial input during a
   failing page-9 read on the U64, and diff it against the bridge's wire output
   (enable bridge TRACE: the `QLink TX` / `SEND RAW` hex lines). This
   *definitively* splits the problem: identical bytes ⇒ it's render/super_buffer
   under load (hypotheses 1–2); different bytes ⇒ it's U64 delivery
   (hypotheses 3, or overrun-drops from 1).
2. **Read the 6551 overrun/status bits** in the C64 NMI handler during the read;
   log or count overruns. Confirms hypothesis 1.
3. **Instrument the super_buffer** (`next_avail_byte`, `next_packet`,
   `super_buffer_full`, `is_there_space` result) during the read. Confirms/kills
   hypothesis 2 and shows the hang.
4. **Try the cheap lever:** raise `qlinkChunkPacing` (and/or lower
   `MAX_PACKET_SIZE`) and re-test on the U64. If corruption drops, the mechanism
   is burst-overrun and the fix is delivery-pacing (bridge-side and/or U64-side).
   Randy can bump the bridge value; he knows the modem's burst behavior.
5. **Reproduce in the sim** (§7) using whatever §1 reveals, so there's a
   regression test that fails today and passes after your fix.

---

## 9. Code pointers

**Bridge (Go, this repo):**
- `bridge_v2/bridge/qlink_codec.go` — frame format, CRC-16 (poly 0xA001),
  encode/decode, `QLinkCRCError`.
- `bridge_v2/bridge/qlink_session.go` — frame loop, `qlinkProcessAck`
  (go-back-1 retransmit, window free rules), `sendSplitHabitatAction` (chunking),
  `qlinkChunkPacing`, `sendQLinkNak`.
- `bridge_v2/bridge/client_session.go` — `sendToClient` (split decision),
  `SendBuf`, qlink sequence state.
- `bridge_v2/bridge/constants.go` — `MAX_PACKET_SIZE=100`, `SPLIT_*`,
  `ESCAPE_CHAR=0x5D`, `END_OF_MESSAGE=0x0D`, `MICROCOSM_ID_BYTE=0x55`.
- `bridge_v2/bridge/utils.go` — `Escape`/`Descape`.
- `bridge_v2/bridge/qlink_reassembly_sim_test.go` — the simulation (§7).

**C64 client (`~/habitat-orig/sources/c64`, Randy's — ground truth):**
- `Main/protocol.m` — RS232I receive, `RSINBF` (128-byte limit),
  `INWIND` dedup, `WINADJ`/`GETSEQ`, seq wrap (`p_get_next_seq_number`).
- `Main/mikes_protocol.m` — CRC, `bad_pkt` (snd_NAK+discard), `snd_NAK`
  debounce, packet framing constants (`SYNC=0x5A`, `NAK=0x25`, offsets).
- `Main/comm_control.m` — `handle_response` (descape + copy into super_buffer),
  `is_there_space` (super_buffer / `super_buffer_full` jam), split flags.
- `Main/text_handler.m` — the document read/render (the thing that competes for
  cycles with the RX NMI).

**Prod ops:** bridge runs as `systemd bridge_v2.service` on `themade`
(`ssh neohabitat`); logs `sudo journalctl -u bridge_v2`; TRACE gives per-frame
`QLink TX`/`SEND RAW` hex.

---

## 10. Evidence appendix — Snog's prod session (2026-07-03, session 4, U64)

- Constant **inbound CRC mismatches** (`qlink: CRC mismatch`) — the C64→bridge
  direction was corrupting frames (reported CRC constant `0x86c9` from the
  heartbeat, *calculated* varying: `0xb489`, `0x98f8`, `0x76f0`, …), i.e. a
  genuinely noisy/overrunning link.
- **200+ go-back-1 retransmits** over ~9 minutes; window grew to 8–13 frames;
  repeated **Habitat NAKs**; the ack counter kept advancing (no protocol
  livelock after the fixes) but the render was garbled and the session eventually
  reset.
- The failing page's `->CLIENT` buffer diffed **identical** to the DB (§3b).
- Emulator on a clean link rendered the identical page perfectly.

That combination — correct bytes queued, correct render on a clean link, garble
only under the U64's loss/retransmit storm — is the whole case in one line: **the
bytes are right; the U64 can't take delivery of them under load.**
