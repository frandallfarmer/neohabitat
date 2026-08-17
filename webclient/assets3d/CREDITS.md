# Third-party 3D assets

CC0 imposes no attribution requirement. We record provenance anyway, because a year from now the
question "where did this mesh come from and are we allowed to ship it?" is much cheaper to answer
from a file than from memory.

## `quaternius-casual.glb`

| | |
|---|---|
| Name | **Casual Character**, from the *Ultimate Modular Men* pack |
| Author | Quaternius — <https://quaternius.com/packs/ultimatemodularcharacters.html> |
| License | **CC0 1.0 Universal** (public domain) — <https://creativecommons.org/publicdomain/zero/1.0/> |
| Obtained via | <https://poly.pizza/m/kZ3DmIoGip> → `https://static.poly.pizza/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb` |
| Retrieved | 2026-08-17 |
| Size | 1.4 MB, single-file `.glb` (geometry + skeleton + 24 clips, no external buffers) |

Quaternius' own site serves the pack through itch.io and a Google Drive folder, neither of which is
scriptable; poly.pizza mirrors the same CC0 models with a stable direct URL, which is why the file
came from there. Same asset, same license.

**Why the Casual Character and not one of the other ten.** Habitat's avatar customization colors
exactly three zones — legs, torso, sleeves (`limbPatternsFromMod` in `habirender/region.js`) — plus
skin. A person in a plain shirt and trousers is the one character in the pack whose material split
already lines up with that. The Astronaut, SWAT and King all carry costume detail Habitat has no
slot for.

### What is actually in the file (verified by decoding it, not from the store page)

- **4 meshes, one skeleton.** `Casual2_Legs`, `Casual2_Feet`, `Casual2_Body`, `Casual2_Head` — the
  pack's "4 swappable parts". Four separate skins, all 62 joints, all the same joint list, so parts
  can be swapped or hidden independently. `Casual2_Head` is the one we hide: a Habitat avatar wears
  a Habitat head.
- **No textures.** `images: 0`. Nine flat-color materials, and `TEXCOORD_0` exists but addresses
  nothing. This is *better* than the textured case for our purposes — see `render3d/habimat.js`.
- **`COLOR_0` is present on one primitive only** (`Casual2_Legs`) and absent everywhere else, so it
  is not a usable channel; we ignore it.
- **24 animation clips**, all prefixed `CharacterArmature|`:
  `Death, Gun_Shoot, HitRecieve, HitRecieve_2, Idle, Idle_Gun, Idle_Gun_Pointing, Idle_Gun_Shoot,
  Idle_Neutral, Idle_Sword, Interact, Kick_Left, Kick_Right, Punch_Left, Punch_Right, Roll, Run,
  Run_Back, Run_Left, Run_Right, Run_Shoot, Sword_Slash, Walk, Wave`
- **Bone names** (62 joints, standard and clean):
  `Root Body Hips Abdomen Torso Chest Neck Head`, then per side
  `Shoulder UpperArm LowerArm Wrist` + full `Index/Middle/Ring/Pinky/Thumb` finger chains, and
  `UpperLeg LowerLeg Foot PT`.
- Generator: `FBX2glTF v0.9.7`.

### What that means for us

`Walk`, `Idle` and `Wave` land directly on Habitat actions. Everything else in Habitat's
`choreographyActions` — `bend_over`, `point`, `throw`, `frown`, `gimme`, `hand_out`, `sit_*`,
`jump`, `unpocket`, `operate` — has no counterpart here, which is the reason `render3d/poses.json`
and the in-lab pose editor exist rather than a clip-name lookup table.

`Neck`/`Head` is the head mount. `Wrist.R` is the held-object socket.
