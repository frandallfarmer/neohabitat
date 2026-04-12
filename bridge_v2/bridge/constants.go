package bridge

var MAX_PACKET_SIZE int = 100

var MICROCOSM_ID_BYTE uint8 = 0x55
var ESCAPE_CHAR uint8 = 0x5D
var END_OF_MESSAGE uint8 = 0x0D
var ESCAPE_XOR uint8 = 0x55
var PHANTOM_REQUEST uint8 = 0xFA

const SPLIT_START uint8 = 0x20
const SPLIT_MIDDLE uint8 = 0x40
const SPLIT_END uint8 = 0x80
const SPLIT_MASK uint8 = ^(SPLIT_START | SPLIT_MIDDLE | SPLIT_END)

const QLINK_FRAME_START uint8 = 0xAB
const QLINK_FRAME_END uint8 = 0xBA
const QLINK_ESCAPE_CHAR uint8 = 0x5E

var REGION_NOID uint8 = 0
var NORM uint8 = 0

// UNASSIGNED_NOID is the sentinel Elko uses in the "noid" field of objects
// belonging to the session's own user (Avatar, Head, Paper, Tokens, etc.)
// before the bridge has assigned them a local noid. It is deliberately 256
// — one past the uint8 range — so it cannot collide with a legitimate
// in-region noid such as 255 (used for ghosts). This matches the legacy
// Habitat2ElkoBridge.js constant of the same name; HabitatMod.Noid is
// modeled as *uint16 so the sentinel can be represented.
const UNASSIGNED_NOID uint16 = 256

// GHOST_NOID is the noid assigned to a player once they are in the
// amAGhost state. Mirrors av.amAGhost ? 255 : av.noid in
// Habitat2ElkoBridge.js's ContentsVector.send path.
const GHOST_NOID uint8 = 255

type ServerMessage uint8

const (
	DESCRIBE      ServerMessage = 1
	I_QUIT        ServerMessage = 2
	IM_ALIVE      ServerMessage = 3
	CUSTOMIZE     ServerMessage = 4
	FINGER_IN_QUE ServerMessage = 5 // while catchup
	HERE_I_AM     ServerMessage = 6 // materialize!x
	PROMPT_REPLY  ServerMessage = 7
	HEREIS        ServerMessage = 8
	GOAWAY        ServerMessage = 9  // object has left
	PORT          ServerMessage = 10 // we have moved!
	UPDATE_DISK   ServerMessage = 11 // update disk..
	FIDDLE        ServerMessage = 12 // fiddle with object
	LIGHTING      ServerMessage = 13 // change light level
	MUSIC         ServerMessage = 14 // play a tune
	OBJECT_TALKS  ServerMessage = 15 // an object speaks!
	WAIT_FOR_ANI  ServerMessage = 16 // wait for an object
	CAUGHT_UP     ServerMessage = 17
	APPEAR        ServerMessage = 18
	CHANGE_CONT   ServerMessage = 19
	PROMPT_USER   ServerMessage = 20
	BEEN_MOVED    ServerMessage = 21
	HOST_DUMP     ServerMessage = 22
)

type ObjectMessage uint8

const (
	Answer         ObjectMessage = 4
	Askoracle      ObjectMessage = 4
	Attack         ObjectMessage = 4
	Bash           ObjectMessage = 5
	Bugout         ObjectMessage = 4
	Catalog        ObjectMessage = 5
	Close          ObjectMessage = 4
	Closecontainer ObjectMessage = 4
	Deposit        ObjectMessage = 1
	Dial           ObjectMessage = 5
	Fakeshoot      ObjectMessage = 4
	Feed           ObjectMessage = 4
	Fill           ObjectMessage = 4
	Flush          ObjectMessage = 6
	Get            ObjectMessage = 1
	Grab           ObjectMessage = 4
	Hand           ObjectMessage = 5
	Hang           ObjectMessage = 6
	Load           ObjectMessage = 6
	Magic          ObjectMessage = 4
	Newregion      ObjectMessage = 9
	Off            ObjectMessage = 4
	Offplayer      ObjectMessage = 4
	On             ObjectMessage = 5
	Onplayer       ObjectMessage = 5
	Open           ObjectMessage = 5
	Opencontainer  ObjectMessage = 5
	Pay            ObjectMessage = 4
	Payto          ObjectMessage = 4
	Playmessage    ObjectMessage = 4
	Posture        ObjectMessage = 6
	Pour           ObjectMessage = 5
	Pullpin        ObjectMessage = 4
	Put            ObjectMessage = 2
	Read           ObjectMessage = 4
	Readlabel      ObjectMessage = 4
	Readmail       ObjectMessage = 4
	Readme         ObjectMessage = 4
	Reset          ObjectMessage = 5
	Roll           ObjectMessage = 4
	Rub            ObjectMessage = 4
	Scan           ObjectMessage = 4
	Select         ObjectMessage = 6
	Sendmail       ObjectMessage = 5
	Setanswer      ObjectMessage = 5
	Speak          ObjectMessage = 7
	Take           ObjectMessage = 4
	Talk           ObjectMessage = 7
	Throw          ObjectMessage = 3
	Throwaway      ObjectMessage = 3
	Unhook         ObjectMessage = 8
	Unload         ObjectMessage = 7
	Walk           ObjectMessage = 8
	Wind           ObjectMessage = 4
	Wish           ObjectMessage = 5
	Withdraw       ObjectMessage = 2
	Write          ObjectMessage = 5
	Zapto          ObjectMessage = 5
	Esp_speak      ObjectMessage = 11
)
