// live.js — the 2D web client entry point (unchanged UX). Boots the shared client shell
// (lib/app-shell.js — the source of truth for UI behavior) with the 2D renderer adapter. The 3D
// client is the sibling lib/live3d.js: same shell, a different adapter. Keep this thin — all UI
// logic lives in the shell; all 2D-render/coordinate specifics live in render2d-adapter.js.
import { boot } from "./app-shell.js"
import { make2DAdapter } from "./render2d-adapter.js"

boot(make2DAdapter)
