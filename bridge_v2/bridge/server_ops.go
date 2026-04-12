package bridge

type ServerOp struct {
	Reqno    uint8
	ToClient func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool
}

var ServerOps = make(map[string]*ServerOp)

func init() {
	ServerOps["ANNOUNCE_$"] = &ServerOp{Reqno: 10}

	ServerOps["APPEARING_$"] = &ServerOp{
		Reqno: 18,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Appearing)
			return false
		},
	}

	ServerOps["ARRIVAL_$"] = &ServerOp{Reqno: 9}

	ServerOps["ATTACK$"] = &ServerOp{
		Reqno: 9,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.AttackTarget)
			buf.AddInt(*o.AttackDamage)
			return false
		},
	}

	ServerOps["AUTO_TELEPORT_$"] = &ServerOp{
		Reqno: 21,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Direction)
			return false
		},
	}

	ServerOps["BASH$"] = &ServerOp{
		Reqno: 10,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.BashTarget)
			buf.AddInt(*o.BashSuccess)
			return false
		},
	}

	ServerOps["BEEP$"] = &ServerOp{Reqno: 8}

	ServerOps["BLAST$"] = &ServerOp{Reqno: 8}

	ServerOps["CAUGHT_UP_$"] = &ServerOp{
		Reqno: 17,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Err)
			return false
		},
	}

	ServerOps["CHANGE$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.ChangeTarget)
			buf.AddInt(*o.ChangeNewOrientation)
			return false
		},
	}

	ServerOps["CHANGE_CONTAINERS_$"] = &ServerOp{
		Reqno: 19,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.ObjectNoid)
			buf.AddInt(*o.ContainerNoid)
			buf.AddInt(*o.X)
			buf.AddInt(*o.Y)
			// Mirror the container change in c.objects so the
			// recursive removeNoid sweep can later identify this
			// object as a child of its current holder. See PUT$ for
			// the full rationale.
			if obj := s.objects[*o.ObjectNoid]; obj != nil {
				obj.container = *o.ContainerNoid
			}
			return false
		},
	}

	ServerOps["BUGOUT$"] = &ServerOp{Reqno: 8}

	ServerOps["CHANGESTATE$"] = &ServerOp{Reqno: 8}

	ServerOps["CHANGESTATE_$"] = &ServerOp{Reqno: 8}

	ServerOps["CLOSE$"] = &ServerOp{
		Reqno: 12,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Target)
			buf.AddInt(*o.OpenFlags)
			return false
		},
	}

	ServerOps["CLOSECONTAINER$"] = &ServerOp{
		Reqno: 13,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Cont)
			buf.AddInt(*o.OpenFlags)
			return false
		},
	}

	ServerOps["DEPARTING_$"] = &ServerOp{Reqno: 10}

	ServerOps["DEPARTURE_$"] = &ServerOp{Reqno: 11}

	ServerOps["DIAL$"] = &ServerOp{Reqno: 10}

	ServerOps["DIE$"] = &ServerOp{Reqno: 11}

	ServerOps["DIG$"] = &ServerOp{Reqno: 8}

	ServerOps["DRIVE$"] = &ServerOp{Reqno: 8}

	ServerOps["EXPIRE_$"] = &ServerOp{Reqno: 9}

	ServerOps["EXPLODE_$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.PinPulled)
			return false
		},
	}

	ServerOps["FAKESHOOT$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.State)
			return false
		},
	}

	ServerOps["FIDDLE_$"] = &ServerOp{
		Reqno: 12,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Target)
			buf.AddInt(*o.Offset)
			buf.AddInt(*o.ArgCount)
			buf.AddInt(*o.Value)
			return false
		},
	}

	ServerOps["FILL$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.AvatarNoid)
			return false
		},
	}

	ServerOps["FLUSH$"] = &ServerOp{Reqno: 8}

	ServerOps["GET$"] = &ServerOp{
		Reqno: 15,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Target)
			buf.AddInt(*o.How)
			return false
		},
	}

	ServerOps["GOAWAY_$"] = &ServerOp{
		Reqno: 9,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Target)
			return false
		},
	}

	ServerOps["GRAB$"] = &ServerOp{Reqno: 16}

	ServerOps["GRABFROM$"] = &ServerOp{
		Reqno: 17,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.AvatarNoid)
			return false
		},
	}

	ServerOps["HANG$"] = &ServerOp{Reqno: 11}

	ServerOps["HEREIS_$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddHabBuf(s.Vectorize(o.Object, *o.Container))
			return false
		},
	}

	ServerOps["HUNGUP$"] = &ServerOp{Reqno: 12}

	ServerOps["LOAD$"] = &ServerOp{Reqno: 8}

	ServerOps["MAILARRIVED$"] = &ServerOp{Reqno: 8}

	ServerOps["MUNCH$"] = &ServerOp{Reqno: 8}

	ServerOps["NEWHEAD$"] = &ServerOp{Reqno: 31}

	ServerOps["OBJECTSPEAK_$"] = &ServerOp{
		Reqno: 15,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Speaker)
			if o.ASCII != nil {
				buf.AddIntSlice(*o.ASCII)
			} else {
				textStr := *o.Text
				textBound := MinInt(len(textStr), 114)
				buf.AddString(textStr[0:textBound])
			}
			return false
		},
	}

	ServerOps["OFF$"] = &ServerOp{Reqno: 8}

	ServerOps["OFFLIGHT$"] = &ServerOp{Reqno: 8}

	ServerOps["ON$"] = &ServerOp{Reqno: 9}

	ServerOps["ONLIGHT$"] = &ServerOp{Reqno: 9}

	ServerOps["OPEN$"] = &ServerOp{
		Reqno: 18,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Target)
			return false
		},
	}

	ServerOps["OPENCONTAINER$"] = &ServerOp{
		Reqno: 19,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Cont)
			// Forced empty contents vector because elko will send the contents asynchronously.
			buf.AddInt(0)
			return false
		},
	}

	ServerOps["ORACLESPEAK_$"] = &ServerOp{Reqno: 8}

	ServerOps["PAID$"] = &ServerOp{
		Reqno: 30,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Payer)
			buf.AddInt(*o.AmountLo)
			buf.AddInt(*o.AmountHi)
			buf.AddHabBuf(s.Vectorize(o.Object, *o.Container))
			return false
		},
	}

	ServerOps["PAY$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.AmountLo)
			buf.AddInt(*o.AmountHi)
			return false
		},
	}

	ServerOps["PAYTO$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Payer)
			buf.AddInt(*o.AmountLo)
			buf.AddInt(*o.AmountHi)
			return false
		},
	}

	ServerOps["PLAY_$"] = &ServerOp{
		Reqno: 14,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.SfxNumber)
			buf.AddInt(*o.FromNoid)
			return false
		},
	}

	ServerOps["POSTURE$"] = &ServerOp{
		Reqno: 20,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.NewPosture)
			return false
		},
	}

	ServerOps["POUR$"] = &ServerOp{
		Reqno: 9,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.AvatarNoid)
			return false
		},
	}

	ServerOps["PROMPT_USER_$"] = &ServerOp{
		Reqno: 20,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddString(*o.Text)
			return false
		},
	}

	ServerOps["PUT$"] = &ServerOp{
		Reqno: 22,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.ObjectNoid)
			buf.AddInt(*o.Cont)
			buf.AddInt(*o.X)
			buf.AddInt(*o.Y)
			buf.AddInt(*o.How)
			buf.AddInt(*o.Orient)
			// Track the new container locally so the recursive
			// removeNoid sweep can later find this object as a child
			// of its actual holder. Without this, an object that was
			// PUT into another avatar's pocket keeps its original
			// container=0 (region) in c.objects, the holder walks out
			// of the region, removeNoid doesn't see it as a child,
			// and the C64 client is left rendering the object as an
			// orphan floating wherever the holder last stood.
			if obj := s.objects[*o.ObjectNoid]; obj != nil {
				obj.container = *o.Cont
			}
			return false
		},
	}

	ServerOps["REINCARNATE$"] = &ServerOp{Reqno: 23}

	ServerOps["REMOVE$"] = &ServerOp{Reqno: 29}

	ServerOps["RESET$"] = &ServerOp{
		Reqno: 9,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.State)
			return false
		},
	}

	ServerOps["RETURN$"] = &ServerOp{Reqno: 1}

	ServerOps["CHANGELIGHT_$"] = &ServerOp{
		Reqno: 13,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Adjustment)
			return false
		},
	}

	ServerOps["ROLL$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.State)
			return false
		},
	}

	ServerOps["RUB$"] = &ServerOp{
		Reqno: 9,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddString(*o.RubMessage)
			return false
		},
	}

	ServerOps["SCAN$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.ScanType)
			return false
		},
	}

	ServerOps["SELL$"] = &ServerOp{
		Reqno: 9,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Buyer)
			buf.AddInt(*o.ItemPriceLo)
			buf.AddInt(*o.ItemPriceHi)
			buf.AddHabBuf(s.Vectorize(o.Object, ""))
			return false
		},
	}

	ServerOps["SEXCHANGE$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.AvatarNoid)
			return false
		},
	}

	ServerOps["SIT$"] = &ServerOp{
		Reqno: 16,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.UpOrDown)
			buf.AddInt(*o.Cont)
			buf.AddInt(*o.Slot)
			return false
		},
	}

	ServerOps["SPEAK$"] = &ServerOp{
		Reqno: 14,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			textBound := MinInt(len(*o.Text), 114)
			text := *o.Text
			buf.AddString(text[0:textBound])
			return false
		},
	}

	ServerOps["SPEAKFORTUNE$"] = &ServerOp{Reqno: 10}

	ServerOps["SPRAY$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.SpraySprayee)
			buf.AddInt(*o.SprayCustomize0)
			buf.AddInt(*o.SprayCustomize1)
			return false
		},
	}

	ServerOps["TAKE$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Count)
			return false
		},
	}

	ServerOps["TAKEMESSAGE$"] = &ServerOp{Reqno: 8}

	ServerOps["THROW$"] = &ServerOp{
		Reqno: 24,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.ObjectNoid)
			buf.AddInt(*o.X)
			buf.AddInt(*o.Y)
			buf.AddInt(*o.Hit)
			return false
		},
	}

	ServerOps["THROWAWAY$"] = &ServerOp{Reqno: 8}

	ServerOps["TRANSFORM$"] = &ServerOp{Reqno: 8}

	ServerOps["UNHOOK$"] = &ServerOp{Reqno: 15}

	ServerOps["UPDATE$"] = &ServerOp{Reqno: 11}

	ServerOps["UNLOAD$"] = &ServerOp{Reqno: 8}

	ServerOps["VSELECT$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.PriceLo)
			buf.AddInt(*o.PriceHi)
			buf.AddInt(*o.DisplayItem)
			return false
		},
	}

	ServerOps["WAITFOR_$"] = &ServerOp{
		Reqno: 16,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.Who)
			return false
		},
	}

	ServerOps["WALK$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddInt(*o.X)
			buf.AddInt(*o.Y)
			buf.AddInt(*o.How)
			return false
		},
	}

	ServerOps["WEAR$"] = &ServerOp{Reqno: 28}

	ServerOps["WIND$"] = &ServerOp{Reqno: 8}

	ServerOps["WISH$"] = &ServerOp{
		Reqno: 8,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			buf.AddString(*o.WishMessage)
			return false
		},
	}

	ServerOps["ZAPIN$"] = &ServerOp{Reqno: 9}

	ServerOps["ZAPTO$"] = &ServerOp{
		Reqno: 10,
		ToClient: func(o *ElkoMessage, buf *HabBuf, s *ClientSession) bool {
			return false
		},
	}
}
