package bridge

import (
	"fmt"
	"github.com/rs/zerolog/log"
)

type HabBuf struct {
	data []byte
}

func (b *HabBuf) AddBytes(bytes []byte) {
	if log.Trace().Enabled() {
		log.Trace().Msgf("Adding bytes %d to current HabBuf: %s", bytes, b)
	}
	b.data = append(b.data, bytes...)
}

func (b *HabBuf) AddHabBuf(buf *HabBuf) {
	if buf == nil {
		return
	}
	if log.Trace().Enabled() {
		log.Trace().Msgf("Adding HabBuf %s to current HabBuf: %s", buf, b)
	}
	b.data = append(b.data, buf.Data()...)
}

func (b *HabBuf) AddInt(intVal uint8) {
	if log.Trace().Enabled() {
		log.Trace().Msgf("Adding uint8 %d to current HabBuf: %s", intVal, b)
	}
	b.data = append(b.data, intVal)
}

func (b *HabBuf) AddIntSlice(intSlice []uint8) {
	if log.Trace().Enabled() {
		log.Trace().Msgf("Adding []uint8 %d to current HabBuf: %s", intSlice, b)
	}
	for _, intVal := range intSlice {
		b.data = append(b.data, intVal)
	}
}

func (b *HabBuf) AddInt32Slice(int32Slice []int32) {
	if log.Trace().Enabled() {
		log.Trace().Msgf("Adding []int32 %d to current HabBuf: %s", int32Slice, b)
	}
	for _, int32Val := range int32Slice {
		b.data = append(b.data, uint8(int32Val))
	}
}

func (b *HabBuf) AddString(str string) {
	if log.Trace().Enabled() {
		log.Trace().Msgf("Adding string %d to current HabBuf: %s", []byte(str), b)
	}
	b.data = append(b.data, []byte(str)...)
}

func (b *HabBuf) Data() []byte {
	return b.data
}

func (b *HabBuf) String() string {
	return fmt.Sprintf("HabBuf(data=%d)", b.data)
}

func NewHabBufEmpty() *HabBuf {
	return &HabBuf{data: make([]byte, 0)}
}

func NewHabBuf(
	start bool,
	end bool,
	seq uint8,
	noidAndReqnum ...uint8,
) *HabBuf {
	return &HabBuf{
		data: MakeHabitatPacketHeader(start, end, seq, noidAndReqnum...),
	}
}
