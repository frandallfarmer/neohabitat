package bridge

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
	"io"
	"math/rand"
	"net"
	"net/textproto"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/frandallfarmer/neohabitat/bridge_v2/observability"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// nextSessionID is a process-wide monotonic counter used as a stable
// session handle. Reused as the OTel session_id attribute and as a
// structured-log field on every line emitted from a session goroutine.
// We avoid uuid to keep deps small; the counter resets on restart but
// timestamp + ip is plenty to disambiguate across restarts.
var nextSessionID uint64

const MaxClientMessages = 500

var ElkoMsgTerminator = []byte("\n\n")

type ClientSession struct {
	Avatar             *HabitatMod
	Online             bool
	NoidClassList      []uint8
	NoidContents       map[uint8][]uint8
	ObjectStateBundles *HabBuf
	RefToNoid          map[string]uint8
	UserName           string

	// stateMu serializes access to session state shared between the Run
	// goroutine (handleClientMessage) and the elkoReader goroutine
	// (handleElkoMessage). It guards: objects, RefToNoid, objectNoidOrder,
	// contentsVector, replySeq, replyEncoder, nextRegion, nextRegionSet,
	// firstConnection, waitingForAvatar, waitingForAvatarContents, otherNoid,
	// otherContents, otherRef, avatarNoid, UserName, Online, regionRef,
	// userRef, Avatar, ref, user.
	stateMu                  sync.Mutex
	avatarNoid               *uint8
	bridge                   *Bridge
	qlinkMode                bool  // true => Habilink/QLink wire protocol, false => legacy colon-prefix
	// qlinkMu guards qlinkInSeq/qlinkOutSeq. Intentionally separate from
	// stateMu so the QLink TX path (sendQLinkHabitatAction) can update the
	// output sequence under handleClientMessage, which is already holding
	// stateMu. sync.Mutex is non-reentrant, and folding these fields into
	// stateMu produced a deadlock right after logging "->CLIENT" on the
	// IM_ALIVE short-circuit path.
	qlinkMu                  sync.Mutex
	qlinkInSeq               byte  // sequence number of last received QLink Action (peer's send seq)
	qlinkOutSeq              byte  // sequence number of next QLink Action we will send
	clientConn               *ClientConnection
	clientReader             *bufio.Reader
	closeMutex               sync.Mutex
	connected                bool
	contentsVector           *ContentsVector
	done                     chan struct{}
	doneClosed               bool
	elkoConn                 net.Conn
	elkoConnInitWg           sync.WaitGroup
	elkoDone                 chan struct{}
	elkoDoneClosed           bool
	elkoSendChan             chan *ElkoMessage
	elkoWg                   sync.WaitGroup
	firstConnection          bool
	largeRequestCache        []byte
	nextRegion               string
	nextRegionSet            bool
	log                      zerolog.Logger     // sticky avatar/ip/session_id structured fields
	sessionID                string             // monotonic session handle, also a log + span attribute
	ctx                      context.Context    // context carrying the session root span
	span                     trace.Span         // root span for this session, ended in Close()
	jsonPassthrough          bool               // true => client speaks JSON directly to Elko; bridge relays
	objects                  map[uint8]*ElkoMessage
	objectNoidOrder          []uint8
	otherContents            []*ElkoMessage
	otherNoid                *uint8
	otherRef                 string
	packetPrefix             string
	ref                      string
	regionRef                string
	replyEncoder             func(o *ElkoMessage, b *HabBuf, c *ClientSession) bool
	replySeq                 uint8
	user                     *HabitatObject
	userRef                  string
	waitingForAvatar         bool
	waitingForAvatarContents bool
	wg                       sync.WaitGroup
	who                      string
}

func (c *ClientSession) initializeState(replySeq uint8) {
	c.contentsVector = NewContentsVector(c, &replySeq, nil, nil, nil)
	c.objects = make(map[uint8]*ElkoMessage)
	c.objectNoidOrder = make([]uint8, 0)
	c.RefToNoid = make(map[string]uint8)
	c.waitingForAvatar = true
	c.waitingForAvatarContents = false
	c.otherContents = make([]*ElkoMessage, 0)
	c.otherNoid = nil
	c.replySeq = replySeq
}

// TableKey is the key under which the bridge tracks this session in
// its Sessions map. It used to also be the basis for log line prefixes
// — that role has moved to c.log, which carries ip/session_id/avatar
// as zerolog structured fields and is bound at session-creation time
// (re-derived once the avatar arrives via bindAvatar).
func (c *ClientSession) TableKey() string {
	return c.clientConn.RemoteAddr().String()
}

// bindAvatar re-derives the session logger to include the avatar name
// as a sticky structured field, and tags the session span with the same
// avatar attribute so traces in Tempo can be filtered by player.
// Called from the make handler the first time the user's own avatar
// arrives in a region (UserName is set at the same time). Subsequent
// log lines from any goroutine using c.log will have avatar=<name>
// attached.
func (c *ClientSession) bindAvatar(name string) {
	c.log = log.With().
		Str("ip", c.TableKey()).
		Str("session_id", c.sessionID).
		Str("avatar", name).
		Logger()
	if c.span != nil {
		c.span.SetAttributes(observability.AvatarAttr(name))
	}
}

func (c *ClientSession) closeChannels() {
	c.closeMutex.Lock()
	defer c.closeMutex.Unlock()
	if !c.doneClosed {
		close(c.done)
		c.doneClosed = true
	}
	if !c.elkoDoneClosed {
		close(c.elkoDone)
		c.elkoDoneClosed = true
	}
}

func (c *ClientSession) elkoReader() {
	defer c.elkoWg.Done()
	defer c.wg.Done()
	reader := bufio.NewReader(c.elkoConn)
	tp := textproto.NewReader(reader)
	c.elkoConnInitWg.Done()
	for {
		nextLine, err := tp.ReadLineBytes()
		if err != nil {
			c.log.Error().Err(err).Msg("Error reading message from Elko")
			return
		}
		if len(nextLine) == 0 {
			continue
		}
		if c.log.Trace().Enabled() {
			c.log.Trace().Msgf("<-ELKO: %s", string(nextLine))
		}
		elkoMsg := &ElkoMessage{}
		err = json.Unmarshal(nextLine, elkoMsg)
		if err != nil {
			c.log.Error().Err(err).Str("raw", string(nextLine)).Msg("Error parsing Elko message")
			continue
		}
		observability.IncMessagesIn(c.ctx, observability.PeerAttr("elko"))
		if c.jsonPassthrough {
			c.handleElkoMessageJson(nextLine, elkoMsg)
			continue
		}
		c.handleElkoMessage(elkoMsg)
	}
}

func (c *ClientSession) elkoWriter() {
	defer c.elkoWg.Done()
	defer c.wg.Done()
	c.elkoConnInitWg.Done()
	for {
		select {
		case msg := <-c.elkoSendChan:
			// Per-message child span. Ends immediately after the write
			// completes — we don't try to correlate with the reply at the
			// moment because the Elko reply path is broadcast/private/reply
			// from elkoReader, which would require cross-goroutine span
			// state. Latency of the write itself is captured in the span
			// duration plus the bridge_v2.elko.round_trip.seconds histogram
			// recorded inline.
			op := ""
			if msg.Op != nil {
				op = *msg.Op
			}
			sendCtx, span := observability.Tracer.Start(
				c.ctx, "elko.send",
				trace.WithAttributes(observability.OpAttr(op)),
			)
			start := time.Now()
			msgBytes, err := json.Marshal(msg)
			if err != nil {
				c.log.Error().Err(err).Interface("msg", msg).Msg("Error marshalling Elko message")
				span.RecordError(err)
				span.End()
				continue
			}
			if c.log.Trace().Enabled() {
				c.log.Trace().Msgf("->ELKO: %s", string(msgBytes))
			}
			msgBytes = append(msgBytes, ElkoMsgTerminator...)
			_, err = c.elkoConn.Write(msgBytes)
			if err != nil {
				c.log.Error().Err(err).Str("raw", string(msgBytes)).Msg("Error writing Elko message")
				span.RecordError(err)
				span.End()
				return
			}
			observability.IncMessagesOut(sendCtx, observability.PeerAttr("elko"))
			observability.RecordElkoRoundTrip(sendCtx, time.Since(start).Seconds(),
				observability.OpAttr(op))
			span.End()
		case <-c.elkoDone:
			return
		case <-c.done:
			return
		}
	}
}

func (c *ClientSession) sendDiagnosticMessage(text string, noid *uint8) error {
	targetNoid := REGION_NOID
	if noid != nil {
		targetNoid = *noid
	}
	msg := NewHabBuf(
		true,
		true,
		PHANTOM_REQUEST,
		REGION_NOID,
		ServerOps["OBJECTSPEAK_$"].Reqno,
	)
	msg.AddInt(targetNoid)
	msg.AddString(text)
	return c.SendBuf(msg, false)
}

func (c *ClientSession) handleElkoMessage(msg *ElkoMessage) {
	// Hold stateMu for the entire handler so it cannot interleave with
	// handleClientMessage on the Run goroutine. SendBuf calls under the lock
	// may block on the rate-limited client conn, which serializes the two
	// goroutines on the slow path; that's acceptable since they're already
	// de-facto serialized through the elkoSendChan handoff.
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	if *msg.To == "session" {
		if *msg.Op == "exit" {
			whyCode := ""
			if msg.WhyCode != nil {
				whyCode = *msg.WhyCode
			}
			why := ""
			if msg.Why != nil {
				why = *msg.Why
			}
			reason := fmt.Sprintf("Server forced exit [%s] %s", whyCode, why)
			if c.avatarNoid != nil {
				err := c.sendDiagnosticMessage(reason, c.avatarNoid)
				if err != nil {
					c.log.Error().Err(err).Msg("Could not send diagnostic message")
				}
			}
			c.log.Warn().Msg(reason)
			go c.Close()
			return
		}
	}

	if *msg.Op == "make" && msg.You != nil && *msg.You {
		// This connection's avatar has arrived - we have a Habitat session!
		name := msg.Obj.Name
		mod := msg.Obj.Mods[0]

		c.log.Debug().Str("name", name).Msg("Avatar arrived")
		c.bindAvatar(name)

		c.UserName = name
		c.Online = true
		splitTo := strings.Split(*msg.To, "-")
		c.regionRef = fmt.Sprintf("%s-%s", splitTo[0], splitTo[1])
		splitObjRef := strings.Split(msg.Obj.Ref, "-")
		c.userRef = fmt.Sprintf("%s-%s", splitObjRef[0], splitObjRef[1])

		// Elko sends the session user's avatar with noid=256 (UNASSIGNED_NOID);
		// if so, map it to the ghost noid so the client has a valid uint8 to
		// reference. Matches Habitat2ElkoBridge.js ContentsVector.send logic
		// where av.amAGhost ? 255 : av.noid is substituted into the region
		// descriptor at position 4.
		if mod.Noid == nil {
			zero := uint8(0)
			c.avatarNoid = &zero
		} else if *mod.Noid == UNASSIGNED_NOID {
			g := GHOST_NOID
			c.avatarNoid = &g
		} else {
			n := uint8(*mod.Noid)
			c.avatarNoid = &n
		}
		c.waitingForAvatarContents = true
	}

	if msg.Type == "changeContext" {
		// Save for MESSAGE_DESCRIBE to deal with later.
		c.nextRegion = *msg.Context
		// Force enterContext after reconnect? aka Client has prematurely sent MESSAGE_DESCRIBE and we ignored it.
		go c.reconnectToElko(*msg.Immediate, *msg.Context)
		return
	}

	if *msg.Op == "ready" {
		if c.waitingForAvatarContents {
			c.waitingForAvatar = false
			c.waitingForAvatarContents = false
			// Iterate in numerical noid order, not insertion order. The
			// legacy Node bridge walks `client.state.objects[i]` with
			// i=0..max, which gives a deterministic ascending-noid
			// sequence (Habitat2ElkoBridge.js:1317). bridge_v2 used to
			// walk c.objectNoidOrder (Elko make order) which on login
			// places the Avatar (noid 13) BEFORE its pocket items
			// (noids 8-12), because Elko makes the avatar first and
			// then pours its inventory in afterward. That ordering
			// difference ripples into NoidClassList and state-bundle
			// layout on the wire, and something in the C64 client
			// behaves differently when the avatar isn't the last
			// Avatar-class entry in the region list — we've observed
			// me_noid ending up as the first in-pocket noid rather
			// than the actual avatar noid. Matching the legacy sort
			// restores the expected behavior.
			sortedNoids := make([]uint8, 0, len(c.objects))
			for noid := range c.objects {
				sortedNoids = append(sortedNoids, noid)
			}
			sort.Slice(sortedNoids, func(i, j int) bool {
				return sortedNoids[i] < sortedNoids[j]
			})
			for _, noid := range sortedNoids {
				obj := c.objects[noid]
				if obj != nil {
					c.contentsVector.Add(obj)
				}
			}
			c.log.Debug().
				Str("user_ref", c.userRef).
				Str("region_ref", c.regionRef).
				Msg("Avatar known and placed in region")
			err := c.contentsVector.Send()
			if err != nil {
				c.log.Error().Err(err).Msg("Could not send contents vector")
				return
			}
			// May be used by HEREIS/makes after region arrival
			c.contentsVector = NewContentsVector(c, nil, nil, nil, nil)
			return
		}

		if c.otherNoid != nil {
			// Other avatar needs to go out as one package. The legacy
			// bridge compared otherNoid against UNASSIGNED_NOID (256) to
			// skip ghosted connections; in bridge_v2 otherNoid is a
			// *uint8 that's been narrowed at assignment time, so the
			// equivalent "noid isn't unassigned" check is non-zero.
			if *c.otherNoid != 0 {
				for _, elkoMsg := range c.otherContents {
					if elkoMsg != nil {
						c.contentsVector.Add(elkoMsg)
					}
				}
				// Suppress client send for ghosted avatar-connections.
				err := c.contentsVector.Send()
				if err != nil {
					c.log.Error().Err(err).Msg("Could not send contents vector, bailing")
					go c.Close()
					return
				}
				c.otherContents = []*ElkoMessage{}
				otherNoid := uint8(0)
				c.otherNoid = &otherNoid
				c.otherRef = ""
				c.contentsVector = NewContentsVector(c, nil, nil, nil, nil)
				return
			}
			// Eat this, since Elko thinks the region's done and the avatar will arrive later
			// Habitat wants the user's avatar as part of the contents vector.
			return
		}
	}

	//  NEXT UP, TRANSFORM ANY LOGIC

	/* Mapping change region (choosing a canonical direction) to change context
	   is awkward. Habitat wants to send a NEWREGION command and a canonical
	   compass direction. Elko wants to respond to the request with permission
	   to set the user's context to the credentials it supplies, in effect telling
	   the client to "Ask me again to connect to such-and-such-a-place with these
	   credentials."

	   I simply am having the bridge do the extra round trip on behalf of the
	   Habitat Client.
	*/

	if *msg.Op == "" && msg.Type == "" {
		c.log.Warn().Interface("msg", msg).Msg("Badly formatted server message! Ignored")
		return
	}

	if *msg.Op == "delete" {
		if target, found := c.RefToNoid[*msg.To]; found {
			err := c.removeNoid(target)
			if err != nil {
				c.log.Error().Err(err).Uint8("noid", target).Msg("Could not remove noid")
			}
		}
		return
	}

	if *msg.Op == "make" {
		mod := msg.Obj.Mods[0]
		err := c.unpackHabitatObject(msg, *msg.To)
		if err != nil {
			c.log.Error().Err(err).Msg("Could not unpack Habitat object")
			return
		}
		if msg.className == "Avatar" {
			// msg.You is *bool and may be absent from Elko messages for
			// re-make events such as corporate/discorporate, where the
			// server sends a fresh Avatar "make" without re-asserting
			// the "you" marker. Treat missing-or-false as "not me"
			// — matches the legacy bridge's `msg.you` truthiness check.
			isSelf := msg.You != nil && *msg.You
			if !isSelf {
				if mod.SittingIn == nil {
					msg.container = 0
				} else {
					// Pretends this avatar is contained by the seat.
					msg.container = *mod.SittingIn
					mod.Y = mod.SittingSlot
					mod.Activity = mod.SittingAction
					mod.Action = mod.SittingAction
				}
			}
			if !isSelf && !c.waitingForAvatar {
				// Async avatar arrival wants to bunch up contents.
				// msg.Noid is nil here when the arriving avatar is a
				// ghost: unpackHabitatObject early-returns on
				// UNASSIGNED_NOID (256) without populating o.Noid. The
				// downstream "ready" handler distinguishes
				// ghost-vs-real by *c.otherNoid == 0, so we must store
				// a non-nil zero sentinel rather than nil — otherwise
				// every subsequent make for that ghost's pocket items
				// (default head, tokens, etc.) skips the otherNoid
				// branch, falls through to the HEREIS path, and
				// dereferences a nil msg.Noid.
				if msg.Noid != nil {
					c.otherNoid = msg.Noid
				} else {
					ghostSentinel := uint8(0)
					c.otherNoid = &ghostSentinel
				}
				c.otherRef = msg.ref
				c.otherContents = append(c.otherContents, msg)
				hereIs := uint8(HEREIS)
				c.contentsVector = NewContentsVector(c, &PHANTOM_REQUEST, &REGION_NOID, msg.To, &hereIs)
				return
			}
		}
		if c.waitingForAvatar {
			if msg.You != nil {
				c.ref = msg.ref
				c.regionRef = *msg.To
				c.Avatar = mod
				c.waitingForAvatarContents = true
				// The next "ready" will build the full contents vector and send it to the client.
			}
			return
		}
		if c.otherNoid != nil {
			// Keep building other's content list.
			msg.container = *c.otherNoid
			// This will get sent on "ready"
			c.otherContents = append(c.otherContents, msg)
			return
		}
		// Otherwise this is a simple object that can be sent out one thing at a time.
		if c.log.Debug().Enabled() {
			c.log.Debug().Interface("msg", msg).Msg("make -> HEREIS")
		}
		buf := NewHabBuf(
			true,
			true,
			PHANTOM_REQUEST,
			REGION_NOID,
			uint8(HEREIS),
		)
		buf.AddInt(*msg.Noid)
		buf.AddInt(msg.classNumber)
		buf.AddInt(0)
		EncodeElkoModState(mod, msg.container, buf)
		buf.AddInt(0)
		err = c.SendBuf(buf, true)
		if err != nil {
			c.log.Error().Err(err).Msg("Could not send HabBuf to client during HEREIS")
		}
		return
	}
	// End of Special Cases - parse the reply/broadcast/neighbor/private message as a object-command.
	c.encodeAndSendClientMessage(msg)
}

func (c *ClientSession) encodeAndSendClientMessage(msg *ElkoMessage) {
	split := false
	if msg.Type == "reply" {
		buf := NewHabBuf(true, true, c.replySeq, *msg.Noid, *msg.Filler)
		if c.replyEncoder != nil {
			split = c.replyEncoder(msg, buf, c)
		}
		err := c.SendBuf(buf, split)
		if err != nil {
			c.log.Error().Err(err).Msg("Could not send HabBuf to client during encode/send")
		}
		return
	}
	if serverOp, found := ServerOps[*msg.Op]; found {
		msg.reqno = serverOp.Reqno
		msg.toClient = serverOp.ToClient
		buf := NewHabBuf(true, true, PHANTOM_REQUEST, *msg.Noid, msg.reqno)
		if msg.toClient != nil {
			split = msg.toClient(msg, buf, c)
		}
		err := c.SendBuf(buf, split)
		if err != nil {
			c.log.Error().Err(err).Msg("Could not send HabBuf to client during encode/send")
		}
	} else {
		c.log.Warn().Interface("msg", msg).Msg("Message from server headed to binary client not converted")
	}
}

func (c *ClientSession) unpackHabitatObject(o *ElkoMessage, containerRef string) error {
	mod := o.Obj.Mods[0]
	o.mod = mod
	o.ref = o.Obj.Ref
	o.className = *mod.Type
	o.classNumber = 0
	if classNumber, found := ClassNameToId[*mod.Type]; found {
		o.classNumber = classNumber
	}

	// Ghost Hack, mirroring Habitat2ElkoBridge.js:559-561 —
	// Elko uses noid=256 (UNASSIGNED_NOID) as a sentinel for the
	// session user's own Avatar/Head/Paper/Tokens. Those objects are
	// silently skipped from the session's object table here; the
	// downstream ContentsVector.Send path rewrites the 256 in the
	// container descriptor to the player's real avatar noid (255 if
	// ghost, else av.noid).
	if mod.Noid != nil && *mod.Noid == UNASSIGNED_NOID {
		return nil
	}

	if mod.Noid == nil {
		zeroVal := uint8(0)
		o.Noid = &zeroVal
	} else {
		// mod.Noid is *uint16 but we've already filtered UNASSIGNED_NOID,
		// so the remaining values fit in uint8.
		localNoid := uint8(*mod.Noid)
		o.Noid = &localNoid
	}

	if clientMessages, found := ObjectClientMessages[*mod.Type]; found {
		o.clientMessages = clientMessages
		o.container = 0
		if containerNoid, found := c.RefToNoid[containerRef]; found {
			o.container = containerNoid
		}
		c.objects[*o.Noid] = o
		c.objectNoidOrder = append(c.objectNoidOrder, *o.Noid)
		c.RefToNoid[o.ref] = *o.Noid
		return nil
	}
	return fmt.Errorf("attempted to instantiate class %s which is not supported",
		o.className)
}

func (c *ClientSession) removeNoid(noid uint8) error {
	obj := c.objects[noid]

	// Snapshot direct children before mutating any maps. When an avatar
	// walks out of the region carrying inventory (e.g. a spray bottle in
	// their pocket), Elko broadcasts `delete` only for the avatar's ref,
	// not for each contained item — so without a recursive sweep the
	// pocket items linger in c.objects with a container noid that no
	// longer exists, and the C64 client renders them as orphans floating
	// in mid-air at the avatar's last position. The stranded objects can
	// also wedge the path-finder, locking the client on the next GO.
	var children []uint8
	for childNoid, childObj := range c.objects {
		if childNoid == noid {
			continue
		}
		if childObj != nil && childObj.container == noid {
			children = append(children, childNoid)
		}
	}

	buf := NewHabBuf(true, true, PHANTOM_REQUEST, REGION_NOID, uint8(GOAWAY))
	buf.AddInt(noid)
	if err := c.SendBuf(buf, false); err != nil {
		return err
	}
	if obj != nil && obj.Obj != nil {
		delete(c.RefToNoid, obj.Obj.Ref)
	}
	delete(c.objects, noid)
	for i, curNoid := range c.objectNoidOrder {
		if curNoid == noid {
			c.objectNoidOrder = append(c.objectNoidOrder[:i], c.objectNoidOrder[i+1:]...)
			break
		}
	}

	for _, childNoid := range children {
		if err := c.removeNoid(childNoid); err != nil {
			return err
		}
	}
	return nil
}

func (c *ClientSession) setFirstConnection() error {
	// Targeted update rather than a whole-document round-trip through
	// HabitatMod, which would strip every Elko @JSONMethod parameter
	// the Go struct doesn't know about (restricted, lastConnectedDay,
	// from_orientation, magic_data[1..5], etc.).
	return c.patchHabitatMod(c.userRef, bson.M{
		"mods.0.firstConnection": true,
	})
}

// upsertHabitatObj writes a full HabitatObject to mongo (creating it if
// it doesn't exist). Use this ONLY for freshly-constructed objects where
// the Go struct IS the authoritative state (e.g. ensureUserCreated's new
// user, addDefaultHead's new head). For updates to existing objects —
// anything read from mongo first and then modified — use patchHabitatMod
// with dotted-path updates instead. Whole-doc $set on an existing object
// clobbers every field the Go HabitatMod struct doesn't model, which
// silently strips Elko-side state across sessions.
func (c *ClientSession) upsertHabitatObj(obj *HabitatObject) (err error) {
	_, err = c.bridge.MongoCollection.UpdateOne(
		c.bridge.mongoCtx,
		bson.M{"ref": obj.Ref},
		bson.M{"$set": obj},
		options.Update().SetUpsert(true),
	)
	return
}

// patchHabitatMod applies a targeted `$set` update to an existing object,
// preserving all fields the Go HabitatMod struct doesn't model. Keys in
// the updates map must be full mongo paths (e.g. "mods.0.firstConnection",
// "mods.0.turf"). Does NOT upsert — if the ref isn't in mongo, no doc is
// created (callers that might race with creation should check existence
// first via findHabitatObj).
func (c *ClientSession) patchHabitatMod(ref string, updates bson.M) error {
	if len(updates) == 0 {
		return nil
	}
	_, err := c.bridge.MongoCollection.UpdateOne(
		c.bridge.mongoCtx,
		bson.M{"ref": ref},
		bson.M{"$set": updates},
	)
	return err
}

func (c *ClientSession) addDefaultHead(userRef string, fullName string) (err error) {
	headRef := fmt.Sprintf("item-head.%d", rand.Int63())
	_, err = c.bridge.MongoCollection.InsertOne(
		c.bridge.mongoCtx,
		&HabitatObject{
			Ref:  headRef,
			Type: "item",
			Name: fmt.Sprintf("Default head for %s", fullName),
			In:   userRef,
			Mods: []*HabitatMod{
				{
					Type:        StringP("Head"),
					Y:           Uint8P(6),
					Style:       Uint8P(uint8(rand.Intn(220))),
					Orientation: Uint8P(uint8(rand.Intn(3) * 8)),
				},
			},
		},
	)
	return
}

func (c *ClientSession) addPaperPrime(userRef string, fullName string) (err error) {
	paperRef := fmt.Sprintf("item-paper.%d", rand.Int63())
	_, err = c.bridge.MongoCollection.InsertOne(
		c.bridge.mongoCtx,
		&HabitatObject{
			Ref:  paperRef,
			Type: "item",
			Name: fmt.Sprintf("Paper for %s", fullName),
			In:   userRef,
			Mods: []*HabitatMod{
				{
					Type:        StringP("Paper"),
					Y:           Uint8P(4),
					Orientation: Uint8P(16),
				},
			},
		},
	)
	return
}

func (c *ClientSession) addDefaultTokens(userRef string, fullName string) (err error) {
	tokenRef := fmt.Sprintf("item-tokens.%d", rand.Int63())
	_, err = c.bridge.MongoCollection.InsertOne(
		c.bridge.mongoCtx,
		&HabitatObject{
			Ref:  tokenRef,
			Type: "item",
			Name: fmt.Sprintf("Money for %s", fullName),
			In:   userRef,
			Mods: []*HabitatMod{
				{
					Type:    StringP("Tokens"),
					Y:       Uint8P(0),
					DenomLo: Uint8P(0),
					DenomHi: Uint8P(4),
				},
			},
		},
	)
	return
}

func (c *ClientSession) findHabitatObj(ref string) (*HabitatObject, error) {
	cur, err := c.bridge.MongoCollection.
		Find(c.bridge.mongoCtx, bson.M{"ref": ref})
	if err != nil {
		return nil, err
	}
	defer cur.Close(c.bridge.mongoCtx)
	if cur.Next(c.bridge.mongoCtx) {
		obj := &HabitatObject{}
		err := cur.Decode(obj)
		if c.log.Debug().Enabled() {
			ev := c.log.Debug().Str("ref", ref).Interface("obj", obj)
			if err != nil {
				ev = ev.Err(err)
			}
			ev.Msg("Found HabitatObject")
		}
		return obj, err
	}
	return nil, nil
}

func (c *ClientSession) ensureTurfAssigned(userRef string) (err error) {
	user, err := c.findHabitatObj(userRef)
	if err != nil {
		return
	}
	if user.HasTurf() {
		c.log.Debug().
			Str("user_ref", userRef).
			Str("turf", *user.Mods[0].Turf).
			Msg("User already has a turf Region assigned")
		return
	}
	region := &HabitatObject{}
	err = c.bridge.MongoCollection.FindOne(
		c.bridge.mongoCtx,
		bson.M{
			"mods.0.type":    "Region",
			"mods.0.is_turf": true,
			"$or": bson.A{
				bson.M{"mods.0.resident": bson.M{"$exists": false}},
				bson.M{"mods.0.resident": ""},
			},
		}).
		Decode(region)
	if err != nil {
		return
	}
	// Targeted updates: only touch the two fields we're actually
	// changing. Whole-document writes would strip every Elko-side
	// field the Go struct doesn't model (restricted, lastConnectedDay,
	// etc.).
	if err = c.patchHabitatMod(region.Ref, bson.M{
		"mods.0.resident": user.Ref,
	}); err != nil {
		return
	}
	return c.patchHabitatMod(user.Ref, bson.M{
		"mods.0.turf": region.Ref,
	})
}

func (c *ClientSession) ensureUserCreated(fullName string) (err error) {
	c.userRef = fmt.Sprintf("user-%s", strings.Replace(
		strings.ToLower(fullName), " ", "_", -1))
	c.log.Debug().Str("user_ref", c.userRef).Str("full_name", fullName).Msg("Resolved user ref")
	if c.firstConnection {
		var user *HabitatObject
		user, err = c.findHabitatObj(c.userRef)
		if err != nil {
			return
		}
		if user != nil {
			err = c.setFirstConnection()
			if err != nil {
				return
			}
			err = c.ensureTurfAssigned(c.userRef)
			if err != nil {
				return
			}
			user, err = c.findHabitatObj(c.userRef)
			if err != nil {
				return
			}
			c.user = user
			return
		}
		user = &HabitatObject{
			Type: "user",
			Ref:  c.userRef,
			Name: fullName,
			Mods: []*HabitatMod{
				{
					Type:            StringP("Avatar"),
					FirstConnection: BoolP(true),
					AmAGhost:        BoolP(true),
					X:               Uint8P(10),
					Y:               Uint8P(128 + uint8(rand.Intn(32))),
					BodyType:        StringP("male"),
					BankBalance:     Uint32P(50000),
					Custom: Int32SP([]int32{
						int32(rand.Intn(15) + rand.Intn(15)*16),
						int32(rand.Intn(15) + rand.Intn(15)*16),
					}),
					NittyBits: Uint8P(0),
				},
			},
		}
		c.log.Info().Interface("user", user).Msg("Creating new User")
		err = c.upsertHabitatObj(user)
		if err != nil {
			return
		}
		err = c.addDefaultHead(c.userRef, fullName)
		if err != nil {
			return
		}
		err = c.addPaperPrime(c.userRef, fullName)
		if err != nil {
			return
		}
		err = c.addDefaultTokens(c.userRef, fullName)
		if err != nil {
			return
		}
		err = c.ensureTurfAssigned(c.userRef)
		if err != nil {
			return
		}
		user, err = c.findHabitatObj(c.userRef)
		if err != nil {
			return
		}
		c.user = user
	}
	return
}

func (c *ClientSession) nextClientMsg() ([]byte, error) {
	for {
		nextByte, err := c.clientReader.ReadByte()
		if err != nil {
			return []byte{}, err
		}
		if nextByte == QLINK_FRAME_START {
			break
		} else {
			c.log.Debug().Hex("byte", []byte{nextByte}).Msg("Received unframed byte")
		}
	}
	msgLength, err := c.clientReader.ReadByte()
	if err != nil {
		return []byte{}, err
	}
	msgBytes := make([]byte, int(msgLength))
	_, err = io.ReadFull(c.clientReader, msgBytes)
	if err != nil {
		return []byte{}, err
	}
	nextByte, err := c.clientReader.ReadByte()
	if err != nil {
		return msgBytes, err
	}
	if nextByte != QLINK_FRAME_END {
		c.log.Debug().Hex("byte", []byte{nextByte}).Msg("Did not receive frame end byte")
	}
	msg := DescapeQLinkMsg(msgBytes)
	if log.Trace().Enabled() {
		log.Trace().Msgf("RECV: %s -> %d", c.clientConn.RemoteAddr().String(), msg)
	}
	return msg, nil
}

func (c *ClientSession) connectToElko() error {
	c.log.Debug().Str("elko_host", c.bridge.elkoHost).Msg("Connecting to Elko")
	var err error
	c.elkoConn, err = net.Dial("tcp", c.bridge.elkoHost)
	if err != nil {
		return err
	}
	// Adds for both elkoReader and elkoWriter must happen on the launching
	// goroutine, before they're started, to satisfy sync.WaitGroup's contract.
	c.wg.Add(2)
	c.elkoWg.Add(2)
	c.elkoConnInitWg.Add(2)
	go c.elkoReader()
	go c.elkoWriter()
	c.elkoConnInitWg.Wait()
	return nil
}

func (c *ClientSession) reconnectToElko(immediate bool, context string) {
	c.log.Debug().Msg("Reconnecting to Elko")
	_ = c.elkoConn.Close()
	select {
	case c.elkoDone <- struct{}{}:
	default:
	}
	c.elkoWg.Wait()
	err := c.connectToElko()
	if err != nil {
		// Elko reachability is a hard invariant — see Bridge.Run.
		c.log.Fatal().Err(err).Str("elko_host", c.bridge.elkoHost).Msg("Could not reconnect to Elko")
	}
	if immediate {
		c.enterContext(context)
	}
}

func (c *ClientSession) Run() {
	// Peek the first packet to detect protocol. Three paths:
	//
	//  1. First byte '{' and first line contains "LOGIN"  → Habilink
	//     (JSON preamble then QLink wire frames).
	//  2. First byte '{' but no LOGIN                      → pure JSON
	//     passthrough (thin/web client speaking Elko JSON directly).
	//  3. Anything else                                    → legacy
	//     colon-prefix binary (`<name>:<bytes>`). Only valid when the
	//     bridge is not in QLink mode.
	//
	// Matches Habitat2ElkoBridge.js's per-connection framing detection.
	peek, _ := c.clientReader.Peek(256)
	if len(peek) > 0 && peek[0] == '{' {
		if isHabilinkLoginPreamble(peek) {
			c.runHabilink()
			return
		}
		defer c.wg.Done()
		c.jsonPassthrough = true
		c.log.Info().Msg("JSON passthrough session connected.")
		c.runJsonPassthrough()
		return
	}
	if c.qlinkMode {
		// Bridge configured for QLink but client didn't send a `{` —
		// fall through to runHabilink anyway; its preamble read will
		// surface whatever the actual framing is.
		c.runHabilink()
		return
	}
	defer c.wg.Done()

	c.log.Info().Msg("ClientSession connected.")

	if err := c.connectToElko(); err != nil {
		// Elko reachability is a hard invariant — see Bridge.Run.
		c.log.Fatal().Err(err).Str("elko_host", c.bridge.elkoHost).Msg("Unable to connect to Elko")
	}

	for {
		data, err := c.nextClientMsg()
		if err != nil {
			c.log.Error().Err(err).Msg("Error reading from Habitat client")
			go c.Close()
			return
		}
		if !c.connected {
			c.handleInitialClientMessage(data)
		} else {
			c.handleClientMessage(data)
		}
	}
}

// isHabilinkLoginPreamble distinguishes Habilink's JSON login line
// (`{"to":"bridge","op":"LOGIN","name":"..."}` followed by QLink wire
// frames) from a pure JSON-passthrough client (which speaks Elko JSON
// continuously). Both start with '{'. We look at a peek window of the
// first packet for the `"LOGIN"` op marker; Habilink's preamble always
// contains it and no Elko op does.
func isHabilinkLoginPreamble(peek []byte) bool {
	nl := len(peek)
	if idx := indexByte(peek, '\n'); idx >= 0 {
		nl = idx
	}
	firstLine := peek[:nl]
	return containsSubslice(firstLine, []byte(`"LOGIN"`)) ||
		containsSubslice(firstLine, []byte(`"op":"LOGIN"`))
}

func indexByte(b []byte, c byte) int {
	for i := 0; i < len(b); i++ {
		if b[i] == c {
			return i
		}
	}
	return -1
}

func containsSubslice(hay, needle []byte) bool {
	if len(needle) == 0 || len(hay) < len(needle) {
		return len(needle) == 0
	}
	for i := 0; i <= len(hay)-len(needle); i++ {
		match := true
		for j := 0; j < len(needle); j++ {
			if hay[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

// runJsonPassthrough is the entry point for JSON-mode clients (thin/web
// clients that speak Elko JSON directly rather than the binary Habitat
// protocol). The bridge mostly relays bytes, but must still:
//
//  - Ensure the Elko user object exists in mongo on "entercontext"
//    (the binary path does this via the <name>: prefix; JSON clients
//    never send that, so we extract from the "user" field).
//  - Reconnect to Elko on "changeContext" messages from the server
//    (handled in elkoReader's handleElkoMessageJson path).
//  - Synthesize FINGER_IN_QUE + I_AM_HERE when Elko sends "ready"
//    after the user's avatar arrives — the C64 client would emit
//    these naturally on region unpack completion, and Elko waits
//    for them before activating the avatar.
func (c *ClientSession) runJsonPassthrough() {
	if err := c.connectToElko(); err != nil {
		c.log.Fatal().Err(err).Str("elko_host", c.bridge.elkoHost).Msg("Unable to connect to Elko")
	}
	tp := textproto.NewReader(c.clientReader)
	for {
		line, err := tp.ReadLineBytes()
		if err != nil {
			c.log.Error().Err(err).Msg("Error reading from JSON client")
			go c.Close()
			return
		}
		if len(line) == 0 {
			continue
		}
		observability.IncMessagesIn(c.ctx, observability.PeerAttr("client"))
		if c.log.Trace().Enabled() {
			c.log.Trace().Bytes("msg", line).Msg("<-CLIENT JSON")
		}
		// Peek at the op/user fields to intercept entercontext — need
		// to ensure the user exists in mongo before Elko processes the
		// request. Unmarshal errors are non-fatal; the Elko side will
		// reject malformed messages.
		var msg ElkoMessage
		if jerr := json.Unmarshal(line, &msg); jerr == nil {
			if msg.Op != nil && *msg.Op == "entercontext" && msg.User != nil {
				userName := strings.TrimPrefix(*msg.User, "user-")
				c.stateMu.Lock()
				if uerr := c.ensureUserCreated(userName); uerr != nil {
					c.log.Error().Err(uerr).Str("user", userName).
						Msg("Could not ensure User created, relaying entercontext anyway")
				}
				c.bindAvatar(userName)
				c.UserName = userName
				c.stateMu.Unlock()
			}
		}
		// Relay the raw JSON to Elko verbatim so we don't lose any
		// fields that our Go structs don't model.
		if err := c.sendRawToElko(line); err != nil {
			c.log.Error().Err(err).Msg("Could not forward JSON to Elko")
			go c.Close()
			return
		}
	}
}

// sendRawToElko writes a raw JSON line to the Elko connection followed
// by the \n\n message terminator. Safe in JSON passthrough mode because
// nothing else writes to elkoConn — we skip the elkoWriter goroutine's
// channel path entirely.
func (c *ClientSession) sendRawToElko(line []byte) error {
	packet := make([]byte, 0, len(line)+2)
	packet = append(packet, line...)
	packet = append(packet, ElkoMsgTerminator...)
	observability.IncMessagesOut(c.ctx, observability.PeerAttr("elko"))
	_, err := c.elkoConn.Write(packet)
	return err
}

// sendOpToElko marshals a minimal ElkoMessage (to/op) to JSON and forwards
// it to Elko with the framing terminator. Used for the synthesized
// FINGER_IN_QUE / I_AM_HERE handshake messages in JSON passthrough mode.
func (c *ClientSession) sendOpToElko(to, op string) error {
	msg := &ElkoMessage{To: &to, Op: &op}
	bytes, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return c.sendRawToElko(bytes)
}

// handleElkoMessageJson relays an Elko message to a JSON-passthrough
// client with the minimum set of state transitions required to keep
// Elko's session machinery happy:
//
//  - On `make` with `you:true`, mark the session as waiting for avatar
//    contents so the next `ready` triggers the handshake.
//  - On `changeContext`, remember the target region and reconnect the
//    Elko TCP socket (mirrors binary-mode behavior).
//  - On `ready` while waiting, synthesize FINGER_IN_QUE + I_AM_HERE
//    toward Elko and swallow the `ready` (the client didn't need it).
//  - Everything else: relay the raw bytes to the client verbatim.
func (c *ClientSession) handleElkoMessageJson(raw []byte, msg *ElkoMessage) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()

	// "you:true" on an avatar make → track so we can synthesize the
	// arrival handshake on the next "ready".
	if msg.Op != nil && *msg.Op == "make" && msg.You != nil && *msg.You {
		c.waitingForAvatarContents = true
		c.regionRef = ""
		if msg.To != nil {
			c.regionRef = *msg.To
		}
	}

	if msg.Type == "changeContext" {
		if msg.Context != nil {
			c.nextRegion = *msg.Context
		}
		immediate := false
		if msg.Immediate != nil {
			immediate = *msg.Immediate
		}
		go c.reconnectToElko(immediate, c.nextRegion)
		// Relay the changeContext to the client as well — some JSON
		// clients act on it directly.
		c.writeJsonToClient(raw)
		return
	}

	if msg.Op != nil && *msg.Op == "ready" && c.waitingForAvatarContents {
		c.waitingForAvatarContents = false
		to := ""
		if msg.To != nil {
			to = *msg.To
		}
		// Synthesize the two messages the C64 would send after a
		// successful region unpack. These go back to Elko, not to
		// the client.
		if err := c.sendOpToElko(to, "FINGER_IN_QUE"); err != nil {
			c.log.Error().Err(err).Msg("Could not send synthesized FINGER_IN_QUE")
		}
		if err := c.sendOpToElko(to, "I_AM_HERE"); err != nil {
			c.log.Error().Err(err).Msg("Could not send synthesized I_AM_HERE")
		}
		// Don't relay the `ready` itself — the JS bridge swallows it
		// in this path too.
		return
	}

	c.writeJsonToClient(raw)
}

// writeJsonToClient writes a raw JSON line to the client connection
// followed by \n\n. Bypasses the Habitat-level escape that clientConn.Write
// applies (JSON clients don't use it).
func (c *ClientSession) writeJsonToClient(raw []byte) {
	if c.log.Trace().Enabled() {
		c.log.Trace().Bytes("msg", raw).Msg("->CLIENT JSON")
	}
	packet := make([]byte, 0, len(raw)+2)
	packet = append(packet, raw...)
	packet = append(packet, '\n', '\n')
	if _, err := c.clientConn.WriteRaw(packet); err != nil {
		c.log.Error().Err(err).Msg("Error writing JSON to client")
	}
	observability.IncMessagesOut(c.ctx, observability.PeerAttr("client"))
}

func (c *ClientSession) handleInitialClientMessage(data []byte) {
	// Hacked Qlink bridge doesn't send QLink header but a user-string instead:
	// <user string>:<raw bytes of inbound Habitat packet>
	colonIndex := -1
	for i, curByte := range data {
		if curByte == ':' {
			colonIndex = i
			break
		}
	}
	if colonIndex == -1 {
		c.log.Error().Bytes("data", data).Msg("Received unknown initial client message")
		return
	}
	fullName := string(data[0:colonIndex])
	c.stateMu.Lock()
	c.packetPrefix = string(data[0 : colonIndex+1])
	err := c.ensureUserCreated(fullName)
	c.stateMu.Unlock()
	if err != nil {
		c.log.Error().Err(err).Msg("Could not ensure User created, bailing")
		go c.Close()
		return
	}
	// handleClientMessage acquires stateMu itself; do not hold the lock here
	// or we'll deadlock on the non-reentrant mutex.
	c.handleClientMessage(data)
}

func (c *ClientSession) handleClientMessage(data []byte) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	observability.IncMessagesIn(c.ctx, observability.PeerAttr("client"))
	hMsg := Descape(data, len(c.packetPrefix)+8)
	if c.log.Debug().Enabled() {
		c.log.Debug().Bytes("hmsg", hMsg).Msg("<-CLIENT")
	}
	seq := hMsg[1] & 0x0F
	end := (hMsg[1] & 0x80) == 0x80
	start := (hMsg[1] & 0x20) == 0x20
	var noid uint8
	noid = 0
	if len(hMsg) > 2 {
		noid = hMsg[2]
	}
	var reqNum uint8
	reqNum = 0
	if len(hMsg) > 3 {
		reqNum = hMsg[3]
	}
	args := make([]byte, 0)
	if len(hMsg) > 4 {
		args = hMsg[4:]
	}
	if c.log.Trace().Enabled() {
		c.log.Trace().
			Uint8("seq", seq).
			Bool("start", start).
			Bool("end", end).
			Uint8("noid", noid).
			Uint8("req_num", reqNum).
			Bytes("args", args).
			Msg("client message")
	}
	if !c.connected {
		// SHORT CIRCUIT: Direct reply to client without server... It's too early to use this bridge at the object level.
		c.who = c.packetPrefix
		c.connected = true
		aliveReply := NewHabBuf(true, true, PHANTOM_REQUEST, REGION_NOID, uint8(IM_ALIVE))
		aliveReply.AddInt(1)  // SUCCESS
		aliveReply.AddInt(48) // 0
		aliveReply.AddString("BAD DISK")
		err := c.SendBuf(aliveReply, false)
		if err != nil {
			c.log.Error().Err(err).Interface("buf", aliveReply).Msg("Could not send buf")
		}
		return
	} else {
		if seq != PHANTOM_REQUEST {
			c.replySeq = uint8(seq)
		}
		if noid == REGION_NOID {
			if ServerMessage(reqNum) == I_QUIT {
				c.handleClientCrashReport(args)
				return
			}
			if ServerMessage(reqNum) == DESCRIBE {
				// After a (re)connection, only the first request for a contents vector is valid.
				var context string
				if !c.nextRegionSet {
					if c.user != nil &&
						c.user.Mods[0].LastArrivedIn != nil &&
						len(*c.user.Mods[0].LastArrivedIn) > 0 {
						// If the Avatar was previously logged in, sends them to their last known context.
						context = *c.user.Mods[0].LastArrivedIn
						lastArrivedInClear := ""
						c.user.Mods[0].LastArrivedIn = &lastArrivedInClear
					} else {
						// Otherwise, sends them to the default context specified at runtime.
						context = c.bridge.Context
					}
				} else if len(c.nextRegion) > 0 {
					context = c.nextRegion
				} else {
					// Ignore this request, the client is hanging but a changecontext/immediate message is coming to fix this.
					return
				}
				if c.firstConnection {
					c.enterContextAfterRegionChecks(context)
				} else {
					c.enterContext(context)
				}
				return
			}
		}
	}

	// All special cases are resolved. If we get here, we wanted to send the message as-is to the server to handle.
	var obj = c.objects[noid]
	if obj == nil {
		c.log.Error().Uint8("noid", noid).Uint8("req_num", reqNum).
			Msg("Received client message for unknown noid")
		return
	}
	var op = "UNSUPPORTED"
	var ref = obj.Obj.Ref
	// Avatar-verb rerouting. The C64 client's action dispatch
	// occasionally targets a noid in the player's own pocket (often the
	// item visually occupying AVATAR_HAND) when the player actually
	// meant "me" — we've seen it for SPEAK/WALK via godtool (//h help,
	// HAND/give), and for POSTURE/WALK via the tokens-in-hand slot when
	// trying to PUT tokens into pocket. In every case the target noid
	// is owned by the session user (container == avatar noid) and the
	// reqNum maps to an Avatar verb that the target item's class table
	// knows nothing about — so without this rewrite we fall through to
	// UNSUPPORTED and drop the message, leaving the C64 deadlocked
	// waiting on a reply. Resolve the reqNum against the Avatar table
	// instead and retarget the message at the user's session-specific
	// avatar ref (c.ref is of the form `user-<name>-<sessionid>`,
	// which is what Elko's live object id is — the base `user-<name>`
	// ref won't resolve to an in-memory avatar).
	if clientMessage, found := obj.clientMessages[reqNum]; found {
		c.log.Debug().Str("op", clientMessage).Interface("obj", obj).Msg("dispatch")
		op = clientMessage
	} else if avatarOp, avFound := ObjectClientMessages["Avatar"][reqNum]; avFound &&
		len(c.ref) > 0 && c.Avatar != nil && c.Avatar.Noid != nil &&
		obj.container == uint8(*c.Avatar.Noid) {
		op = avatarOp
		ref = c.ref
		c.log.Debug().Str("op", op).Uint8("noid", noid).Str("avatar_ref", ref).
			Msg("Rewriting pocket op to avatar")
	}
	if op == "UNSUPPORTED" {
		c.log.Error().Uint8("req_num", reqNum).Str("ref", ref).Msg("Unsupported client message")
		return
	}
	var elkoMsg = &ElkoMessage{
		To: &ref,
		Op: &op,
	}

	if translator, found := Translators[op]; found {
		c.replyEncoder = translator.ToClient
		if translator.ToServer != nil {
			translator.ToServer(args, elkoMsg, c, start, end)
			if elkoMsg.SuppressReply != nil && *elkoMsg.SuppressReply {
				return
			}
		}
	}

	c.elkoSendChan <- elkoMsg
}

func (c *ClientSession) enterContext(context string) {
	c.log.Debug().Str("context", context).Msg("Entering context")
	enterContextMsg := &ElkoMessage{
		To:      StringP("session"),
		Op:      StringP("entercontext"),
		Context: &context,
		User:    &c.userRef,
	}
	c.elkoSendChan <- enterContextMsg
	if len(context) == 0 {
		c.replySeq = PHANTOM_REQUEST
	}
	c.initializeState(c.replySeq)
	c.nextRegion = ""
	c.nextRegionSet = true
	c.firstConnection = false
}

func (c *ClientSession) enterContextAfterRegionChecks(context string) {
	userRef := c.userRef
	modified := false
	user := &HabitatObject{}
	err := c.bridge.MongoCollection.
		FindOne(c.bridge.mongoCtx, bson.M{"ref": userRef}).
		Decode(user)
	if err != nil {
		c.log.Error().Err(err).Msg("Error during user lookup")
		return
	}
	if user.Mods[0].AmAGhost != nil && *user.Mods[0].AmAGhost {
		c.enterContext(context)
		return
	}
	cur, err := c.bridge.MongoCollection.
		Find(c.bridge.mongoCtx, bson.M{"ref": context})
	if err != nil {
		c.log.Error().Err(err).Msg("Error during region lookup")
		return
	}
	defer cur.Close(c.bridge.mongoCtx)
	if cur.Next(c.bridge.mongoCtx) {
		region := &HabitatObject{}
		err = cur.Decode(region)
		if err != nil {
			c.log.Error().Err(err).Msg("Error during region decode")
			return
		}
		if region.Mods[0].ShutdownSize != nil && *region.Mods[0].ShutdownSize > 8000 {
			// TODO Other tests go here, such as avatars, heads, and instances.
			c.log.Info().
				Str("user_ref", userRef).
				Uint64("region_heap", *region.Mods[0].ShutdownSize).
				Msg("Forcing user to ghost due to region heap")
			user.Mods[0].AmAGhost = BoolP(true)
			modified = true
		}
	} else {
		turf := ""
		if user.Mods[0].Turf != nil {
			turf = *user.Mods[0].Turf
		}
		c.log.Info().
			Str("context", context).
			Str("user_ref", userRef).
			Str("turf", turf).
			Msg("Unable to find last Region; redirecting to Turf")
		// Matches the original bridge: when the last Region is gone, force ghost as
		// well as redirecting to the user's Turf so they can re-enter safely.
		user.Mods[0].AmAGhost = BoolP(true)
		context = turf
		modified = true
	}
	if modified {
		// Targeted update: only the ghost flag changed. Whole-doc
		// writes would strip every Elko field the Go struct doesn't
		// model.
		if err := c.patchHabitatMod(user.Ref, bson.M{
			"mods.0.amAGhost": true,
		}); err != nil {
			c.log.Error().Err(err).Str("user_ref", user.Ref).Msg("Could not update user")
			return
		}
	}
	c.enterContext(context)
}

func (c *ClientSession) sendToClient(data []byte, split bool) error {
	if c.qlinkMode {
		// QLink mode still has to honor Habitat split-packet framing. The
		// C64's receive buffer is ~256 bytes and anything larger has to be
		// delivered as a sequence of Habitat packets carrying the
		// SPLIT_START / SPLIT_MIDDLE / SPLIT_END flags in seqByte[1].
		// A complex region's DESCRIBE can run 400+ bytes; sending that as
		// one QLink Action frame produces a Habitat NAK (type 0x25) and
		// the client freezes on "infinite region transfer".
		if !split || len(data) <= 4+MAX_PACKET_SIZE {
			return c.sendQLinkHabitatAction(data)
		}
		return c.sendSplitHabitatAction(data)
	}
	header := data[0:4]
	if split {
		payload := data[4:]
		for start := 0; start < len(payload); start += MAX_PACKET_SIZE {
			chunk := payload[start:]
			size := MinInt(MAX_PACKET_SIZE, len(chunk))
			seqByte := header[1] & SPLIT_MASK
			if start == 0 {
				seqByte |= SPLIT_START
			}
			seqByte |= SPLIT_MIDDLE
			if size == len(chunk) {
				seqByte |= SPLIT_END
			}
			header[1] = seqByte
			packet := make([]byte, 0)
			packet = append(packet, []byte(c.packetPrefix)...)
			packet = append(packet, header...)
			packet = append(packet, chunk[0:size]...)
			packet = append(packet, END_OF_MESSAGE)
			if c.log.Trace().Enabled() {
				c.log.Trace().Bytes("packet", packet).Msg("Sending split packet to client")
			}
			_, err := c.clientConn.Write(packet)
			if err != nil {
				return err
			}
		}
	} else {
		packet := make([]byte, 0)
		packet = append(packet, []byte(c.packetPrefix)...)
		packet = append(packet, data...)
		packet = append(packet, END_OF_MESSAGE)
		if c.log.Trace().Enabled() {
			c.log.Trace().Bytes("packet", packet).Msg("Sending packet to client")
		}
		_, err := c.clientConn.Write(packet)
		if err != nil {
			return err
		}
	}
	return nil
}

func (c *ClientSession) SendBuf(buf *HabBuf, split bool) error {
	if c.log.Debug().Enabled() {
		c.log.Debug().Bool("split", split).Bytes("buf", buf.data).Msg("->CLIENT")
	}
	observability.IncMessagesOut(c.ctx, observability.PeerAttr("client"))
	return c.sendToClient(buf.Data(), split)
}

func (c *ClientSession) Start() {
	c.wg.Add(1)
	go c.Run()
}

func (c *ClientSession) Close() {
	if c.elkoConn != nil {
		_ = c.elkoConn.Close()
	}
	if c.clientConn != nil {
		_ = c.clientConn.Close()
	}
	c.closeChannels()
	c.wg.Wait()
	c.log.Info().Msg("ClientSession closed.")
	if c.span != nil {
		c.span.End()
	}
	go c.bridge.RemoveSession(c)
}

// handleClientCrashReport processes a MESSAGE_I_QUIT from the C64 client.
// The classic client sends 1 byte (error_number only). The extended U64
// client sends 12 bytes of diagnostic state. The bridge distinguishes
// them by arg count — no protocol negotiation needed.
func (c *ClientSession) handleClientCrashReport(args []byte) {
	if len(args) == 0 {
		c.log.Error().Msg("Client crash report with empty payload")
		observability.IncClientCrashes(c.ctx)
		go c.Close()
		return
	}
	ev := c.log.Error().Uint8("error_number", args[0])
	isExtended := len(args) >= 6

	if isExtended {
		ev = ev.
			Uint8("reg_a", args[1]).
			Uint8("me_noid", args[2]).
			Uint8("heartbeat", args[3]).
			Uint8("seqout", args[4]).
			Uint8("initst", args[5])
	}
	ev.Bool("extended", isExtended).Msg("Client crash report")

	observability.IncClientCrashes(c.ctx)
	if c.span != nil {
		attrs := []trace.EventOption{
			trace.WithAttributes(
				observability.AvatarAttr(c.UserName),
				attribute.Int("error_number", int(args[0])),
			),
		}
		c.span.AddEvent("client.crash", attrs...)
	}

	if !isExtended {
		// Classic client exits to QLink swap screen — session is over.
		go c.Close()
		return
	}
	// Extended client: keep the session alive. The C64 will attempt
	// reconnection by sending a fresh MESSAGE_describe, which triggers
	// the normal enterContext flow. Reset session state so the next
	// DESCRIBE is treated as a fresh login.
	c.log.Info().Msg("Extended client crash — keeping session alive for reconnection")
	c.connected = false
	c.initializeState(c.replySeq)
}

func (c *ClientSession) Vectorize(
	newObj *HabitatObject, containerRef string) *HabBuf {
	o := &ElkoMessage{Obj: newObj}
	err := c.unpackHabitatObject(o, containerRef)
	if err != nil {
		c.log.Error().Err(err).Interface("obj", o).
			Msg("Could not unpack object during vectorization")
		return nil
	}
	buf := NewHabBufEmpty()
	buf.AddInt(*o.Noid)
	buf.AddInt(o.classNumber)
	buf.AddInt(0)
	EncodeElkoModState(o.mod, o.container, buf)
	buf.AddInt(0)
	return buf
}

func NewClientSession(b *Bridge, c *ClientConnection) *ClientSession {
	id := strconv.FormatUint(atomic.AddUint64(&nextSessionID, 1), 10)
	remoteAddr := c.RemoteAddr().String()
	// Bind ip + session_id immediately. The avatar field is empty until
	// the first make-with-you arrives, at which point bindAvatar
	// re-derives the logger to include it.
	sessionLogger := log.With().
		Str("ip", remoteAddr).
		Str("session_id", id).
		Logger()
	// Start the per-session root span. The trace.Span returned is a noop
	// when OTel is disabled, so this is free in the default config. The
	// session_id and ip attributes pin the span to its log lines for
	// cross-referencing in Grafana Cloud.
	sessionCtx, span := observability.Tracer.Start(
		context.Background(),
		"session",
		trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(
			observability.SessionIDAttr(id),
			observability.IPAttr(remoteAddr),
		),
	)
	session := &ClientSession{
		NoidClassList:            []uint8{},
		NoidContents:             make(map[uint8][]uint8),
		RefToNoid:                make(map[string]uint8),
		bridge:                   b,
		clientConn:               c,
		clientReader:             bufio.NewReader(c),
		ctx:                      sessionCtx,
		span:                     span,
		elkoDone:                 make(chan struct{}),
		elkoSendChan:             make(chan *ElkoMessage, MaxClientMessages),
		firstConnection:          true,
		log:                      sessionLogger,
		sessionID:                id,
		objects:                  make(map[uint8]*ElkoMessage),
		done:                     make(chan struct{}),
		qlinkMode:                b.QLinkMode,
		qlinkInSeq:               QLinkSeqLow,
		qlinkOutSeq:              QLinkSeqLow,
		waitingForAvatar:         true,
		waitingForAvatarContents: false,
	}
	session.contentsVector = NewContentsVector(session, nil, &REGION_NOID, nil, nil)
	return session
}
