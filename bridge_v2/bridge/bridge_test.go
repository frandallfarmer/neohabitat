package bridge

import (
	"bufio"
	"io"
	"net"
	"reflect"
	"sync"
	"testing"
	"time"
)

// discardConn is a fake net.Conn that throws away writes and immediately
// returns EOF on reads. Used to satisfy ClientConnection in tests that need
// SendBuf to succeed without actually transmitting anything.
type discardConn struct{}

func (d *discardConn) Read(b []byte) (int, error)         { return 0, io.EOF }
func (d *discardConn) Write(b []byte) (int, error)        { return len(b), nil }
func (d *discardConn) Close() error                       { return nil }
func (d *discardConn) LocalAddr() net.Addr                { return &net.IPAddr{} }
func (d *discardConn) RemoteAddr() net.Addr               { return &net.IPAddr{} }
func (d *discardConn) SetDeadline(t time.Time) error      { return nil }
func (d *discardConn) SetReadDeadline(t time.Time) error  { return nil }
func (d *discardConn) SetWriteDeadline(t time.Time) error { return nil }

// newTestSession constructs a minimal ClientSession suitable for unit tests.
// It uses a discardConn so SendBuf calls succeed without I/O. The Bridge has
// a high data rate so the rate limiter never blocks the test.
func newTestSession() *ClientSession {
	bridge := &Bridge{DataRate: 1 << 20}
	cc := NewClientConnection(bridge, &discardConn{})
	sess := &ClientSession{
		NoidClassList:   []uint8{},
		NoidContents:    make(map[uint8][]uint8),
		RefToNoid:       make(map[string]uint8),
		bridge:          bridge,
		clientConn:      cc,
		clientReader:    bufio.NewReader(cc),
		elkoDone:        make(chan struct{}),
		elkoSendChan:    make(chan *ElkoMessage, MaxClientMessages),
		firstConnection: true,
		objects:         make(map[uint8]*ElkoMessage),
		done:            make(chan struct{}),
	}
	sess.contentsVector = NewContentsVector(sess, nil, &REGION_NOID, nil, nil)
	return sess
}

// addObject inserts a fake object into the session's tracked maps.
func addObject(s *ClientSession, noid uint8, ref string) {
	o := &ElkoMessage{
		Obj: &HabitatObject{Ref: ref},
	}
	s.objects[noid] = o
	s.RefToNoid[ref] = noid
	s.objectNoidOrder = append(s.objectNoidOrder, noid)
}

// ----- Group A -----

// A1: HEREIS_$ reqno must be 8 (HEREIS), not 17 (WAIT_FOR_ANI).
func TestServerOps_HereisReqno(t *testing.T) {
	op, ok := ServerOps["HEREIS_$"]
	if !ok {
		t.Fatal("HEREIS_$ not registered")
	}
	if op.Reqno != uint8(HEREIS) {
		t.Errorf("HEREIS_$ Reqno = %d, want %d (HEREIS)", op.Reqno, uint8(HEREIS))
	}
}

// A2: CHANGELIGHT_$ reqno must be 13 (LIGHTING), not 9 (GOAWAY).
func TestServerOps_ChangelightReqno(t *testing.T) {
	op, ok := ServerOps["CHANGELIGHT_$"]
	if !ok {
		t.Fatal("CHANGELIGHT_$ not registered")
	}
	if op.Reqno != uint8(LIGHTING) {
		t.Errorf("CHANGELIGHT_$ Reqno = %d, want %d (LIGHTING)", op.Reqno, uint8(LIGHTING))
	}
}

// A3: CLOSE$ ToClient must write Target and OpenFlags (not ChangeTarget/ChangeNewOrientation).
func TestServerOps_CloseFields(t *testing.T) {
	op := ServerOps["CLOSE$"]
	if op == nil || op.ToClient == nil {
		t.Fatal("CLOSE$ has no ToClient encoder")
	}
	target := uint8(7)
	flags := uint8(0x42)
	msg := &ElkoMessage{Target: &target, OpenFlags: &flags}
	buf := NewHabBufEmpty()
	op.ToClient(msg, buf, nil)
	if !reflect.DeepEqual(buf.Data(), []byte{7, 0x42}) {
		t.Errorf("CLOSE$ encoded %v, want [7 66]", buf.Data())
	}
}

// A4: THROW translator must populate Target/X/Y from args[0..2], not double-write Target.
func TestThrowTranslator_AllArgs(t *testing.T) {
	tr := Translators["THROW"]
	if tr == nil || tr.ToServer == nil {
		t.Fatal("THROW has no ToServer translator")
	}
	m := &ElkoMessage{}
	tr.ToServer([]byte{3, 50, 100}, m, nil, false, false)
	if m.Target == nil || *m.Target != 3 {
		t.Errorf("Target = %v, want 3", m.Target)
	}
	if m.X == nil || *m.X != 50 {
		t.Errorf("X = %v, want 50", m.X)
	}
	if m.Y == nil || *m.Y != 100 {
		t.Errorf("Y = %v, want 100", m.Y)
	}
}

func TestThrowTranslator_PartialArgs(t *testing.T) {
	tr := Translators["THROW"]
	cases := []struct {
		name                string
		args                []byte
		wantT, wantX, wantY uint8
	}{
		{"empty", []byte{}, 0, 8, 130},
		{"one", []byte{9}, 9, 8, 130},
		{"two", []byte{9, 77}, 9, 77, 130},
		{"three", []byte{9, 77, 200}, 9, 77, 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := &ElkoMessage{}
			tr.ToServer(c.args, m, nil, false, false)
			if m.Target == nil || *m.Target != c.wantT {
				t.Errorf("Target = %v, want %d", m.Target, c.wantT)
			}
			if m.X == nil || *m.X != c.wantX {
				t.Errorf("X = %v, want %d", m.X, c.wantX)
			}
			if m.Y == nil || *m.Y != c.wantY {
				t.Errorf("Y = %v, want %d", m.Y, c.wantY)
			}
		})
	}
}

// A5: Picture encoder must use the "massive" base, which prepends a Mass byte.
// Asserts the result is one byte longer than common-based output.
func TestEncoder_Picture_HasMassByte(t *testing.T) {
	mod := &HabitatMod{
		Type:    StringP("Picture"),
		Style:   Uint8P(1),
		X:       Uint8P(2),
		Y:       Uint8P(3),
		Mass:    Uint8P(7),
		Picture: Int32SP([]int32{10, 20, 30}),
	}
	buf := EncodeElkoModState(mod, 0, NewHabBufEmpty())
	// common = 6 bytes (style,x,y,orient,gr_state,container)
	// massive adds 1 (mass) = 7 bytes
	// Picture adds 3 picture bytes = 10 total
	if len(buf.Data()) != 10 {
		t.Errorf("Picture encoded length = %d, want 10 (common[6] + mass[1] + picture[3])", len(buf.Data()))
	}
	// Mass must appear at byte 6 (just after common's 6 bytes).
	if buf.Data()[6] != 7 {
		t.Errorf("Mass byte = %d, want 7", buf.Data()[6])
	}
}

// A6: Roof encoder must be registered and not panic.
func TestEncoder_Roof_Registered(t *testing.T) {
	mod := &HabitatMod{
		Type:  StringP("Roof"),
		Style: Uint8P(5),
		X:     Uint8P(10),
		Y:     Uint8P(20),
	}
	buf := EncodeElkoModState(mod, 0, NewHabBufEmpty())
	if buf == nil || len(buf.Data()) == 0 {
		t.Fatal("Roof encoder produced empty buffer")
	}
	// Roof = common = 6 bytes.
	if len(buf.Data()) != 6 {
		t.Errorf("Roof encoded length = %d, want 6", len(buf.Data()))
	}
}

func TestOriginalHatcheryEnabled(t *testing.T) {
	t.Setenv("NEOHABITAT_ORIGINAL_HATCHERY", "true")
	if !originalHatcheryEnabled() {
		t.Fatal("NEOHABITAT_ORIGINAL_HATCHERY=true should enable original hatchery")
	}
	t.Setenv("NEOHABITAT_ORIGINAL_HATCHERY", "0")
	if originalHatcheryEnabled() {
		t.Fatal("NEOHABITAT_ORIGINAL_HATCHERY=0 should disable original hatchery")
	}
}

func TestParseHatcheryAppearance(t *testing.T) {
	appearance, ok := parseHatcheryAppearance([]byte{7, 16, 24, 0x12, 0x34})
	if !ok {
		t.Fatal("expected valid hatchery appearance")
	}
	if appearance.headStyle != 7 ||
		appearance.hairPattern != 16 ||
		appearance.avatarOrientation != 24 ||
		appearance.custom0 != 0x12 ||
		appearance.custom1 != 0x34 {
		t.Fatalf("appearance = %+v", appearance)
	}
	if _, ok := parseHatcheryAppearance([]byte{1, 2, 3, 4}); ok {
		t.Fatal("short hatchery payload should be rejected")
	}
}

func TestNewHatcheryCustomizationVectorRandomizesAllowedHeads(t *testing.T) {
	vector := NewHatcheryCustomizationVector()
	if len(vector) != len(HatcheryCustomizationVector) {
		t.Fatalf("vector length = %d, want %d", len(vector), len(HatcheryCustomizationVector))
	}
	if &vector[0] == &HatcheryCustomizationVector[0] {
		t.Fatal("customization vector should be copied, not modified in place")
	}
	assertAllowedUnique := func(name string, start int, allowed []uint8) {
		t.Helper()
		allowedSet := make(map[uint8]bool, len(allowed))
		for _, head := range allowed {
			allowedSet[head] = true
		}
		seen := make(map[uint8]bool, 4)
		for i := 0; i < 4; i++ {
			style := vector[hatcheryHeadStyleOffset+(start+i)*hatcheryHeadRecordSize]
			if !allowedSet[style] {
				t.Fatalf("%s head style %d is not in allowed list", name, style)
			}
			if seen[style] {
				t.Fatalf("%s head style %d was repeated", name, style)
			}
			seen[style] = true
		}
	}
	assertAllowedUnique("male", 0, hatcheryAllowedMaleHeads)
	assertAllowedUnique("female", 4, hatcheryAllowedFemaleHeads)
}

// ----- Group B -----

// B1a: removeNoid removes a middle element from objectNoidOrder.
func TestRemoveNoid_Middle(t *testing.T) {
	s := newTestSession()
	addObject(s, 1, "ref-1")
	addObject(s, 5, "ref-5")
	addObject(s, 10, "ref-10")

	if err := s.removeNoid(5); err != nil {
		t.Fatalf("removeNoid err = %v", err)
	}
	if _, ok := s.objects[5]; ok {
		t.Error("noid 5 still in objects")
	}
	if _, ok := s.RefToNoid["ref-5"]; ok {
		t.Error("ref-5 still in RefToNoid")
	}
	if !reflect.DeepEqual(s.objectNoidOrder, []uint8{1, 10}) {
		t.Errorf("objectNoidOrder = %v, want [1 10]", s.objectNoidOrder)
	}
}

// B1b: removeNoid removes the first element (catches the inverted-flag-when-i==0 bug).
func TestRemoveNoid_First(t *testing.T) {
	s := newTestSession()
	addObject(s, 1, "ref-1")
	addObject(s, 5, "ref-5")
	addObject(s, 10, "ref-10")

	if err := s.removeNoid(1); err != nil {
		t.Fatalf("removeNoid err = %v", err)
	}
	if !reflect.DeepEqual(s.objectNoidOrder, []uint8{5, 10}) {
		t.Errorf("objectNoidOrder = %v, want [5 10]", s.objectNoidOrder)
	}
}

// B1c: removeNoid removes the last element.
func TestRemoveNoid_Last(t *testing.T) {
	s := newTestSession()
	addObject(s, 1, "ref-1")
	addObject(s, 5, "ref-5")
	addObject(s, 10, "ref-10")

	if err := s.removeNoid(10); err != nil {
		t.Fatalf("removeNoid err = %v", err)
	}
	if !reflect.DeepEqual(s.objectNoidOrder, []uint8{1, 5}) {
		t.Errorf("objectNoidOrder = %v, want [1 5]", s.objectNoidOrder)
	}
}

// B1d: removeNoid on a noid that was never tracked must not panic and must succeed.
func TestRemoveNoid_NotPresent(t *testing.T) {
	s := newTestSession()
	addObject(s, 1, "ref-1")

	if err := s.removeNoid(99); err != nil {
		t.Fatalf("removeNoid err = %v", err)
	}
	if !reflect.DeepEqual(s.objectNoidOrder, []uint8{1}) {
		t.Errorf("objectNoidOrder = %v, want [1] (unchanged)", s.objectNoidOrder)
	}
}

// B1e: removeNoid where the map entry is nil must not panic on the Obj deref.
func TestRemoveNoid_NilEntry(t *testing.T) {
	s := newTestSession()
	s.objects[7] = nil
	s.objectNoidOrder = []uint8{7}

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("removeNoid panicked on nil entry: %v", r)
		}
	}()
	if err := s.removeNoid(7); err != nil {
		t.Fatalf("removeNoid err = %v", err)
	}
	if _, ok := s.objects[7]; ok {
		t.Error("noid 7 still in objects after removal")
	}
}

// B4: handleClientMessage on an unknown noid must not panic.
func TestHandleClientMessage_UnknownNoid(t *testing.T) {
	s := newTestSession()
	s.connected = true
	s.packetPrefix = "TEST:"
	// Build a 4-byte habitat header for noid=99, reqNum=1, no args, with the
	// usual prefix offset. Descape will skip prefix+8; for our purposes the
	// data must be at least 12 bytes.
	pkt := make([]byte, len(s.packetPrefix)+8+4)
	// stuff dummy bytes into the prefix area
	copy(pkt, []byte(s.packetPrefix))
	// the 4 bytes Descape will return: 0x55, seq, noid=99, reqNum=1
	copy(pkt[len(s.packetPrefix)+8:], []byte{MICROCOSM_ID_BYTE, 0x40, 99, 1})

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("handleClientMessage panicked on unknown noid: %v", r)
		}
	}()
	s.handleClientMessage(pkt)
}

// B5: HELP translator with nil ASCII falls through to Text without panicking.
func TestHelpTranslator_NilAscii(t *testing.T) {
	tr := Translators["HELP"]
	msg := &ElkoMessage{Text: StringP("hi")}
	buf := NewHabBufEmpty()
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("HELP ToClient panicked on nil ASCII: %v", r)
		}
	}()
	tr.ToClient(msg, buf, nil)
	if string(buf.Data()) != "hi" {
		t.Errorf("HELP encoded %q, want %q", string(buf.Data()), "hi")
	}
}

// B5b: HELP with ASCII set encodes the ASCII bytes.
func TestHelpTranslator_AsciiSet(t *testing.T) {
	tr := Translators["HELP"]
	msg := &ElkoMessage{ASCII: &[]uint8{1, 2, 3}}
	buf := NewHabBufEmpty()
	tr.ToClient(msg, buf, nil)
	if !reflect.DeepEqual(buf.Data(), []byte{1, 2, 3}) {
		t.Errorf("HELP encoded %v, want [1 2 3]", buf.Data())
	}
}

// ----- Group D4 — encoder nil-safety -----

// All encoders must tolerate a HabitatMod with no optional fields populated
// (minimal mod) without panicking.
func TestEncoderNilSafety_AllClasses(t *testing.T) {
	classes := []string{
		"common", "document", "magical", "massive", "toggle", "openable",
		"walkable", "polygonal",
		"Region", "Avatar", "Key", "Sign", "Street", "Super_trapezoid",
		"Grenade", "Glue", "Die", "Drugs", "Fake_gun", "Hand_of_god",
		"Flat", "Tokens", "Bottle", "Bridge", "Bureaucrat", "Teleport",
		"Picture", "Roof", "Vendo_front", "Escape_device", "Elevator",
		"Windup_toy", "Magic_lamp", "Aquarium",
		"Amulet", "Atm", "Bag", "Ball", "Bed", "Book", "Box", "Building",
		"Bush", "Chair", "Changomatic", "Chest", "Club", "Coke_machine",
		"Compass", "Couch", "Countertop", "Crystal_ball", "Display_case",
		"Door", "Dropbox", "Fence", "Flag", "Flashlight", "Floor_lamp",
		"Fortune_machine", "Fountain", "Frisbee", "Gemstone", "Game_piece",
		"Garbage_can", "Ghost", "Ground", "Gun", "Head", "Hole", "Hot_tub",
		"House_cat", "Knick_knack", "Knife", "Magic_immobile", "Magic_staff",
		"Magic_wand", "Mailbox", "Matchbook", "Movie_camera", "Paper",
		"Pawn_machine", "Plant", "Plaque", "Pond", "Ring", "Rock", "Safe",
		"Sensor", "Sex_changer", "Short_sign", "Shovel", "Sky", "Spray_can",
		"Streetlamp", "Stun_gun", "Table", "Trapezoid", "Tree", "Vendo_inside",
		"Wall", "Window",
	}
	for _, cls := range classes {
		t.Run(cls, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("encoder %s panicked on sparse mod: %v", cls, r)
				}
			}()
			mod := &HabitatMod{Type: StringP(cls)}
			buf := EncodeElkoModState(mod, 0, NewHabBufEmpty())
			if buf == nil {
				t.Errorf("encoder %s returned nil buffer", cls)
			}
		})
	}
}

// EncodeElkoModState with an unregistered class must not panic.
func TestEncoder_UnknownClass(t *testing.T) {
	mod := &HabitatMod{Type: StringP("ThisClassDoesNotExist")}
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("EncodeElkoModState panicked on unknown class: %v", r)
		}
	}()
	buf := EncodeElkoModState(mod, 0, NewHabBufEmpty())
	if buf == nil {
		t.Error("got nil buffer for unknown class")
	}
}

// ----- Group D2 — concurrency -----

// stateMu must serialize concurrent handlers so the race detector doesn't
// flag map writes. Run a producer/consumer pair against the session for a
// brief window with `go test -race`.
func TestSessionConcurrency_NoRace(t *testing.T) {
	s := newTestSession()
	s.connected = true
	s.packetPrefix = "TEST:"

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// Goroutine 1: simulates the elkoReader path mutating shared maps under stateMu.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				s.stateMu.Lock()
				s.objects[42] = &ElkoMessage{Obj: &HabitatObject{Ref: "ref-42"}}
				s.RefToNoid["ref-42"] = 42
				delete(s.objects, 42)
				delete(s.RefToNoid, "ref-42")
				s.stateMu.Unlock()
			}
		}
	}()

	// Goroutine 2: simulates the Run path reading the maps under stateMu.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				s.stateMu.Lock()
				_ = s.objects[42]
				_ = s.RefToNoid["ref-42"]
				s.stateMu.Unlock()
			}
		}
	}()

	time.Sleep(50 * time.Millisecond)
	close(stop)
	wg.Wait()
}
