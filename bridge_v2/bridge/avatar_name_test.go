package bridge

import "testing"

// validAvatarName gates new-user creation in ensureUserCreated. Names that
// fail are refused a user doc (and therefore a turf); existing users are
// never checked against it.
func TestValidAvatarName(t *testing.T) {
	accept := []string{
		"Randy",
		"c64 noob",
		"webclient2549",
		"hatchtest1782755507633",
		"Ya Mama",
		"O'Brien",
		"Mr. X",
		"a_b-c",
		"69",
		"Z",
	}
	for _, name := range accept {
		if !validAvatarName.MatchString(name) {
			t.Errorf("validAvatarName rejected legitimate name %q", name)
		}
	}

	reject := []string{
		"",
		" leading space",
		"-leading punct",
		"'leading quote",
		"name\x00with nul",
		"name\twith tab",
		"café",
		"12345678901234567890123456789012X", // 33 chars
		// The first bytes of a TLS ClientHello, as sent by internet scanners
		// to the binary port — the exact garbage that was minting users.
		"z\x16\x03\x01\x02\x00\x01\x00\x01\xfc\x03\x03",
		"Z*\x00\xba\xba\xc0\x12\xc0\x13\xc0\x07\xc0'\xcc\x14",
	}
	for _, name := range reject {
		if validAvatarName.MatchString(name) {
			t.Errorf("validAvatarName accepted garbage name %q", name)
		}
	}
}
