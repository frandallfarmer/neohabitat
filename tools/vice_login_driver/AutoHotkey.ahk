/*
NOTE: SendInput, while newer and better, doesn't work consistently when interacting with the C64 in VICE.
This is why you see a mix of both. I try to use SendInput when interacting with VICE and Send when
interacting with the C64
*/

LoadDisk(name)
{
  SendInput !8
  Sleep, 500
  SendInput %name%
  Sleep, 500
  SendInput !a
}

#+F12::
SetKeyDelay, 50, 60

SendInput !w ; warp ON

; load QuantumLink
LoadDisk("QuantumLink.d64")
Send load"*",8,1{enter}

; wait for modem screen
Sleep, 5000

SendInput !w ; warp OFF
Sleep, 1000
Send {F1}
Sleep, 500
SendInput !w ; warp ON

; wait for peoplelink screen
Sleep, 5000

SendInput !w ; warp OFF
Sleep, 1000
Send {F1}
Sleep, 500
SendInput !w ; warp ON

; wait for lobby screen
Sleep, 5000
Send {F7}

SendInput !w ; warp OFF
Send {Down 6}
Send {F1}

; select club caribe
Send {F1 2}
SendInput !w ; warp ON

; wait for side a request
Sleep, 3000
LoadDisk("club-caribe-a.d64")
Send {enter}

; wait for side b request
Sleep, 3000
LoadDisk("club-caribe-b.d64")
Send {enter}

Return