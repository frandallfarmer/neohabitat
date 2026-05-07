package bridge

import "math/rand"

// HatcheryCustomizationVector is the original fake-region contents vector
// from habitat/sources/stratus/Processes/hatchery.pl1. The hatchery sent it
// as byte(2) || customization_vector in response to the client's IM_ALIVE.
var HatcheryCustomizationVector = []uint8{
	0, 0, 32, 0, 1, 0, 0, 0, 0,
	1, 1, 2, 36, 3, 80, 4, 127,
	5, 127, 6, 127, 7, 127, 8, 127,
	9, 127, 10, 127, 11, 127, 0,
	0, 84, 144, 2, 0, 0, 146, 146,
	0, 0, 2, 52,
	1, 0, 4, 228, 0, 0,
	4, 0, 0, 196, 0, 0,
	1, 200, 36, 16, 1, 0,
	2, 200, 38, 16, 1, 0,
	3, 200, 38, 16, 1, 0,
	4, 200, 198, 16, 1, 0,
	11, 200, 36, 16, 1, 0,
	21, 200, 37, 16, 1, 0,
	9, 200, 60, 16, 1, 0,
	30, 200, 36, 24, 1, 0,
	0,
}

var hatcheryAllowedMaleHeads = []uint8{1, 3, 4, 5, 7, 9, 11, 25, 33, 41, 53, 68, 82, 83}
var hatcheryAllowedFemaleHeads = []uint8{2, 21, 30, 48, 56, 64, 65, 80, 84, 87, 89, 131}

const hatcheryHeadStyleOffset = 56
const hatcheryHeadRecordSize = 6

func NewHatcheryCustomizationVector() []uint8 {
	vector := append([]uint8(nil), HatcheryCustomizationVector...)
	for i, style := range pickUniqueHatcheryHeads(hatcheryAllowedMaleHeads, 4) {
		vector[hatcheryHeadStyleOffset+i*hatcheryHeadRecordSize] = style
	}
	for i, style := range pickUniqueHatcheryHeads(hatcheryAllowedFemaleHeads, 4) {
		vector[hatcheryHeadStyleOffset+(i+4)*hatcheryHeadRecordSize] = style
	}
	return vector
}

func pickUniqueHatcheryHeads(heads []uint8, count int) []uint8 {
	selected := make([]uint8, 0, count)
	used := make(map[uint8]bool, count)
	for len(selected) < count {
		head := heads[rand.Intn(len(heads))]
		if used[head] {
			continue
		}
		used[head] = true
		selected = append(selected, head)
	}
	return selected
}
