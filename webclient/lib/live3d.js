// live3d.js — the 3D-native "diorama" web client entry point. Boots the SAME shared client shell as
// the 2D client (lib/app-shell.js — the source of truth for UI behavior) with the 3D renderer
// adapter. Sibling of the 2D lib/live.js; the only difference between the two clients is the adapter.
import { boot } from "./app-shell.js"
import { make3DAdapter } from "./render3d-adapter.js"

boot(make3DAdapter)
