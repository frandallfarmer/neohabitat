package bridge

import (
	"fmt"
	"github.com/rs/zerolog/log"
)

type ContentsVector struct {
	session *ClientSession

	container     *HabBuf
	containers    map[uint8]*ContentsVector
	containerRef  *string
	containerNoid uint8
	contents      map[string][]uint8
	replySeq      uint8
	msgType       uint8
}

// modNoidU8 narrows HabitatMod.Noid (uint16 because of the UNASSIGNED_NOID
// sentinel) to uint8 for in-region bookkeeping. Callers must already have
// filtered UNASSIGNED_NOID or be operating on an object whose noid has
// been remapped by unpackHabitatObject.
func modNoidU8(mod *HabitatMod) uint8 {
	if mod.Noid == nil {
		return 0
	}
	return uint8(*mod.Noid)
}

func (v *ContentsVector) Add(o *ElkoMessage) {
	mod := o.Obj.Mods[0]
	if v.containerRef == nil {
		v.containerRef = o.To
		v.containerNoid = modNoidU8(mod)
		v.containers[v.containerNoid] = v
	}
	if modNoidU8(mod) != v.containerNoid {
		o.clientStateBundle = NewHabBufEmpty()
		EncodeElkoModState(mod, o.container, o.clientStateBundle)
		if v.session.log.Trace().Enabled() {
			v.session.log.Trace().
				Bytes("bundle", o.clientStateBundle.data).
				Uint8("noid", modNoidU8(mod)).
				Interface("mod", mod).
				Msg("Set clientStateBundle")
		}
		if _, found := v.containers[v.containerNoid].contents[*o.To]; !found {
			v.containers[v.containerNoid].contents[*o.To] = []uint8{}
		}
		v.containers[v.containerNoid].contents[*o.To] = append(
			v.containers[v.containerNoid].contents[*o.To], modNoidU8(mod))
	} else {
		EncodeElkoModState(mod, o.container, v.containers[v.containerNoid].container)
	}
}

func (v *ContentsVector) Send() error {
	v.session.NoidContents = make(map[uint8][]uint8)
	v.session.NoidClassList = []uint8{}
	v.session.ObjectStateBundles = NewHabBufEmpty()
	buf := NewHabBuf(true, true, v.replySeq, REGION_NOID, v.msgType)
	if ServerMessage(v.msgType) == DESCRIBE {
		// Region arrives before the avatar, so the avatar's slot in the
		// container descriptor was filled with a placeholder. On the
		// legacy Node bridge this is UNASSIGNED_NOID (256); here the
		// placeholder narrows to uint8(0) because the on-wire container
		// data is []uint8. We use data[4]==0 AND a known avatar to
		// detect the "needs avatar fill-in" case, matching
		// Habitat2ElkoBridge.js ContentsVector.send at lines 629-636.
		av := v.session.Avatar
		if av != nil && v.container != nil && len(v.container.data) >= 9 &&
			v.container.data[4] == 0 {
			if av.AmAGhost != nil && *av.AmAGhost {
				v.container.data[4] = GHOST_NOID
			} else if av.Noid != nil {
				// Filtered UNASSIGNED_NOID in unpackHabitatObject, so
				// *av.Noid fits in uint8.
				v.container.data[4] = uint8(*av.Noid)
			} else {
				v.container.data[4] = GHOST_NOID
			}
			if av.BankBalance != nil {
				v.container.data[5] = uint8(*av.BankBalance & 0x000000FF)
				v.container.data[6] = uint8((*av.BankBalance & 0x0000FF00) >> 8)
				v.container.data[7] = uint8((*av.BankBalance & 0x00FF0000) >> 16)
				v.container.data[8] = uint8((*av.BankBalance & 0xFF000000) >> 24)
			}
		}
		buf.AddHabBuf(v.container)
	}
	// Make nested contents noid-based...
	for cont, _ := range v.contents {
		if noidRef, found := v.session.RefToNoid[cont]; found {
			if _, found = v.session.NoidContents[noidRef]; !found {
				v.session.NoidContents[noidRef] = v.contents[cont]
			}
		}
	}
	// Start recursively adding contents, properly in order.
	v.addContents(REGION_NOID)
	if v.session.log.Trace().Enabled() {
		v.session.log.Trace().Str("dump", v.String()).Msg("ContentsVector")
	}
	buf.AddIntSlice(v.session.NoidClassList)
	buf.AddInt(0)
	buf.AddHabBuf(v.session.ObjectStateBundles)
	buf.AddInt(0)
	return v.session.SendBuf(buf, true)
}

func (v *ContentsVector) String() string {
	contents := FormatStringUint8Map(v.contents)
	noidContents := FormatUint8Uint8Map(v.session.NoidContents)
	noidClassList := fmt.Sprintf("%d", v.session.NoidClassList)
	objectStateBundles := fmt.Sprintf("%d", v.session.ObjectStateBundles.data)
	return fmt.Sprintf(
		"\n\n\ncontents: %s\nnoidContents: %s\nnoidClassList: %s\nobjectStateBundles: %s\n\n\n",
		string(contents), string(noidContents), string(noidClassList),
		string(objectStateBundles))
}

func (v *ContentsVector) addContents(contnoid uint8) {
	for _, noid := range v.session.NoidContents[contnoid] {
		o := v.session.objects[noid]
		mod := o.Obj.Mods[0]
		if _, found := v.session.NoidContents[noid]; found {
			// item IS a container with contents, so write those contents first. Recurse!
			v.addContents(noid)
		}
		v.session.NoidClassList = append(v.session.NoidClassList, noid)
		v.session.NoidClassList = append(v.session.NoidClassList, ClassNameToId[*mod.Type])
		v.session.ObjectStateBundles.AddHabBuf(o.clientStateBundle)
	}
}

func NewContentsVector(
	session *ClientSession,
	replySeq *uint8,
	noid *uint8,
	ref *string,
	msgType *uint8,
) *ContentsVector {
	log.Trace().Msgf("New ContentsVector:")
	rSeq := PHANTOM_REQUEST
	if replySeq != nil {
		log.Trace().Msgf("replySeq: %d", *replySeq)
		rSeq = *replySeq
	}
	mType := uint8(DESCRIBE)
	if msgType != nil {
		log.Trace().Msgf("msgType: %d", *msgType)
		mType = *msgType
	}
	cv := &ContentsVector{
		container:    NewHabBufEmpty(),
		session:      session,
		containers:   make(map[uint8]*ContentsVector),
		contents:     make(map[string][]uint8),
		msgType:      mType,
		replySeq:     rSeq,
		containerRef: ref,
	}
	if noid != nil {
		cv.containers[*noid] = cv
	}
	return cv
}
