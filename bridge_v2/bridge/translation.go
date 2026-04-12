package bridge

type Translator struct {
	ToClient func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool
	ToServer func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool)
}

var Translators = make(map[string]*Translator)

func init() {
	Translators["HELP"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			if o.ASCII != nil && len(*o.ASCII) > 0 {
				b.AddIntSlice(*o.ASCII)
			} else if o.Text != nil {
				text := *o.Text
				textBoundary := MinInt(len(text), 114)
				b.AddString(text[0:textBoundary])
			}
			return false
		},
	}

	Translators["GET"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["PUT"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.ContainerNoid = &a[0]
			m.X = &a[1]
			m.Y = &a[2]
			m.Orientation = &a[3]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			b.AddInt(*o.Pos)
			return false
		},
	}

	Translators["WEAR"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["THROW"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			var target uint8
			target = 0
			m.Target = &target
			if len(a) > 0 {
				m.Target = &a[0]
			}
			var x uint8
			x = 8
			m.X = &x
			if len(a) > 1 {
				m.X = &a[1]
			}
			var y uint8
			y = 130
			m.Y = &y
			if len(a) > 2 {
				m.Y = &a[2]
			}
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Target)
			b.AddInt(*o.X)
			b.AddInt(*o.Y)
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["SPEAK"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Esp = &a[0]
			textStr := string(a[1:])
			m.Text = &textStr
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Esp)
			return false
		},
	}

	Translators["ESP"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			var esp uint8
			esp = 1
			m.Esp = &esp
			textStr := string(a[1:])
			m.Text = &textStr
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Esp)
			return false
		},
	}

	Translators["ASK"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			textStr := string(a)
			m.Text = &textStr
		},
	}

	Translators["WISH"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			textStr := string(a)
			m.Text = &textStr
		},
	}

	Translators["RUB"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.RubSuccess)
			b.AddString(*o.RubMessage)
			return false
		},
	}

	Translators["POSTURE"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Pose = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["WALK"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.X = &a[0]
			m.Y = &a[1]
			m.How = &a[2]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.X)
			b.AddInt(*o.Y)
			if o.How != nil {
				b.AddInt(*o.How)
			}
			return false
		},
	}

	Translators["SITORSTAND"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.UpOrDown = &a[0]
			m.SeatId = &a[1]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			b.AddInt(*o.Slot)
			return false
		},
	}

	Translators["FNKEY"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Key = &a[0]
			m.Target = &a[1]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["CORPORATE"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Success)
			b.AddInt(*o.NewNoid)
			b.AddInt(uint8(*o.Balance & 0x000000FF))
			b.AddInt(uint8((*o.Balance & 0x0000FF00) >> 8))
			b.AddInt(uint8((*o.Balance & 0x00FF0000) >> 16))
			b.AddInt(uint8((*o.Balance & 0xFF000000) >> 24))
			if o.Body != nil {
				b.AddHabBuf(s.Vectorize(o.Body, ""))
			} else {
				b.AddInt(0)
			}
			return false
		},
	}

	Translators["DISCORPORATE"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Success)
			b.AddInt(*o.NewNoid)
			b.AddInt(uint8(*o.Balance & 0x000000FF))
			b.AddInt(uint8((*o.Balance & 0x0000FF00) >> 8))
			b.AddInt(uint8((*o.Balance & 0x00FF0000) >> 16))
			b.AddInt(uint8((*o.Balance & 0xFF000000) >> 24))
			if o.Body != nil {
				b.AddHabBuf(s.Vectorize(o.Body, ""))
			} else {
				b.AddInt(0)
			}
			return false
		},
	}

	Translators["PROMPT_REPLY"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			textStr := string(a)
			m.Text = &textStr
		},
	}

	Translators["MAGIC"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Target = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["OFF"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["ON"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["OPEN"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["CLOSE"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["OPENCONTAINER"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["CLOSECONTAINER"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["FAKESHOOT"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.FakeshootSuccess)
			return false
		},
	}

	Translators["READ"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Page = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.NextPage)
			b.AddIntSlice(*o.ASCII)
			// This reply should be split upon transmission to the client.
			return true
		},
	}

	Translators["WRITE"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			trueVal := true
			m.SuppressReply = &trueVal
			if start {
				s.largeRequestCache = []byte{}
			}
			s.largeRequestCache = append(s.largeRequestCache, a...)
			if end {
				// Elko's WRITE handler expects request_ascii as a Java
				// int[], not a string — JS naturally produces an int
				// array via Array.prototype.push of bytes, but Go's
				// encoding/json marshals []byte as base64 string. Widen
				// to []int so it serializes as a JSON array of ints.
				ints := make([]int, len(s.largeRequestCache))
				for i, b := range s.largeRequestCache {
					ints[i] = int(b)
				}
				m.RequestASCII = &ints
				m.SuppressReply = nil
				s.largeRequestCache = []byte{}
			}
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["RESET"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.ResetSuccess)
			return false
		},
	}

	Translators["ROLL"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.RollState)
			return false
		},
	}

	Translators["SCAN"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.ScanDetection)
			return false
		},
	}

	Translators["LEAVE"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Reason = &a[0]
		},
	}

	Translators["NEWREGION"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Direction = &a[0]
			m.PassageId = &a[1]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["SPRAY"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Limb = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.SpraySuccess)
			b.AddInt(*o.SprayCustomize0)
			b.AddInt(*o.SprayCustomize1)
			return false
		},
	}

	Translators["CHANGE"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.TargetNoid = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			b.AddInt(*o.ChangeNewOrientation)
			return false
		},
	}

	Translators["DIRECT"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			text := *o.Text
			textBounds := MinInt(len(text), 114)
			b.AddString(text[0:textBounds])
			return false
		},
	}

	Translators["ATTACK"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.PointedNoid = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.AttackResult)
			b.AddInt(*o.AttackTarget)
			return false
		},
	}

	Translators["TOUCH"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Target = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["TAKE"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.TakeSuccess)
			return false
		},
	}

	Translators["PAYTO"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			// The C64 client sends PAYTO in two phases: first with a
			// 1-byte payload of [0] to open the payee picker UI, then
			// again with [target, amount_lo, amount_hi] once the user
			// has chosen. The JS bridge tolerated the short first
			// frame because indexing past the end of a JS array yields
			// undefined and JSON.stringify drops undefined fields;
			// Go panics on out-of-range indexing. Mirror the JS
			// behavior by only setting fields whose bytes were
			// actually present.
			if len(a) > 0 {
				m.TargetId = &a[0]
			}
			if len(a) > 1 {
				m.AmountLo = &a[1]
			}
			if len(a) > 2 {
				m.AmountHi = &a[2]
			}
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Success)
			b.AddInt(*o.AmountLo)
			b.AddInt(*o.AmountHi)
			b.AddHabBuf(s.Vectorize(o.Object, *o.Container))
			return false
		},
	}

	Translators["PAY"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			b.AddInt(*o.AmountLo)
			b.AddInt(*o.AmountHi)
			if o.Text != nil {
				text := *o.Text
				textBound := MinInt(len(text), 114)
				b.AddString(text[0:textBound])
			}
			return false
		},
	}

	Translators["PULLPIN"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.PullpinSuccess)
			return false
		},
	}

	Translators["SPLIT"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.AmountLo = &a[0]
			m.AmountHi = &a[1]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["MUNCH"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["STUN"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.Target = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["DEPOSIT"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.TokenNoid = &a[0]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["ZAPTO"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			portNumber := string(a)
			m.PortNumber = &portNumber
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["WITHDRAW"] = &Translator{
		ToServer: func(a []byte, m *ElkoMessage, s *ClientSession, start bool, end bool) {
			m.AmountLo = &a[0]
			m.AmountHi = &a[1]
		},
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.AmountLo)
			b.AddInt(*o.AmountHi)
			b.AddInt(*o.ResultCode)
			return false
		},
	}

	Translators["FILL"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["POUR"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["SEXCHANGE"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["VSELECT"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.PriceLo)
			b.AddInt(*o.PriceHi)
			b.AddInt(*o.DisplayItem)
			return false
		},
	}

	Translators["VEND"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Success)
			b.AddInt(*o.ItemPriceLo)
			b.AddInt(*o.ItemPriceHi)
			b.AddHabBuf(s.Vectorize(o.Object, ""))
			return false
		},
	}

	Translators["FLUSH"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["BUGOUT"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["DIG"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["README"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddIntSlice(*o.ASCII)
			return false
		},
	}

	Translators["PSENDMAIL"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}

	Translators["KING"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.State)
			return false
		},
	}

	Translators["GRAB"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.ItemNoid)
			return false
		},
	}

	Translators["HAND"] = &Translator{
		ToClient: func(o *ElkoMessage, b *HabBuf, s *ClientSession) bool {
			b.AddInt(*o.Err)
			return false
		},
	}
}
