NeoHabitat.org: The Neoclassical Habitat Server Project
=======================================================

[![license](https://img.shields.io/github/license/mashape/apistatus.svg)](https://github.com/frandallfarmer/neohabitat/blob/master/LICENSE)
[![Twitter Follow](https://img.shields.io/twitter/follow/NeoHabitatProj.svg?style=social&label=Follow)](https://twitter.com/NeoHabitatProj)
[Developer Discord](https://discord.gg/rspcX27Vt4)

We're recreating [Lucasfilm's Habitat](https://en.wikipedia.org/wiki/Habitat_(video_game)), the world's first MMO, using modern technology. We'd love it if you joined us!

Play Habitat Now!
-----------------

We run a public server at **habitat.themade.org** with the latest NeoHabitat code. There's often a few members of the regular crew hanging out there, so come say hey!

**No install needed — play in your browser:**

| | |
|---|---|
| 🕹️ **[Play Original Now](http://habitat.themade.org/)** | The genuine C64 client in an in-browser emulator, with the Docent guide — the authentic 1986 experience. |
| ⚡ **[Play Accelerated](http://habitat.themade.org/neohabitat)** | The all-JavaScript [web client](docs/webclient.md) + Docent — same world, no emulator, fast and crisp. |
| 📱 **[Play Mobile](https://habitat.themade.org/webclient/live.html)** | The web client full-page, for phones and tablets. |

**Or install a client:**

- **[C64 emulator (VICE)](docs/c64-clients.md#vice)** — Windows installer, macOS app, or manual Linux/*BSD setup (details also in Step 1 below).
- **[Ultimate 64 / Ultimate II+](docs/c64-clients.md#ultimate-64)** — run the client on U64 hardware over your home network ([full guide](https://github.com/ssalevan/habiclient/blob/main/docs/U64.md)).
- **[Real Commodore 64](README-RealC64.md)** — original iron, floppies, and a WiFi modem.

All the ways in, on one page: **[docs/play.md](docs/play.md)**.

**Please note**: NeoHabitat is still in development, so there will likely be some instability. If you see anything weird, please [tell us about it in our Discord](https://discord.gg/rspcX27Vt4).

### Step 1 - Download and Install either the Windows or OSX Habitat package (which comes with VICE, the C64 emulator)

*(Skip this step if you're using a browser client above — go straight to Step 2.)*

**Windows**

- Download the [NeoHabitat installer](https://github.com/StuBlad/neohabitat-installer/releases/download/1.1/NeoHabitatInstaller1.1.exe)

- Run the installer.
 - Tested on Windows 11 Home v22H2 but it should be fine on older versions of Windows.

- Check the **Launch NeoHabitat** box at the end of the installation, or Double-click the **NeoHabitat** icon on your desktop or in the Start Menu.

- Go to Step 2!

**OS X**

- Download [Neohabitat.dmg](https://github.com/frandallfarmer/neohabitat-doc/blob/master/installers/Neohabitat.dmg?raw=true) and double-click on the DMG file.

- Drag the **NeoHabitat** application to the **Applications** folder.

- **Launch the NeoHabitat application** you dragged to **Applications**.

**Please Note**: OS X may inform you that this app comes from an unknown developer upon first launch. If this happens, **open System Preferences** and click **Security & Privacy**. From the following pane, click **Open Anyway** to launch the NeoHabitat application.

**Linux and \*BSD**

- Install VICE and `nc` (netcat) via your package manager
- Extract the Windows release of [Neohabitat.zip](https://github.com/frandallfarmer/neohabitat-doc/blob/master/installers/Neohabitat.zip?raw=true) to get the `.d64` files and `fliplist-C64.vfl`
- Run the VICE C64 emulator with these options set:  
  `x64 -rsuser -rsuserdev 0 -rsdev1 '|nc habitat.themade.org 1986' -rsuserbaud 1200 -flipname fliplist-C64.vfl Habitat-Boot.d64`
- There is a bug in current versions of VICE which breaks this network support (https://sourceforge.net/p/vice-emu/bugs/1356). Versions including r38928 and earlier work.

### Step 2 - Login and play!

In a few moments, you'll be brought to the NeoHabitat splash screen:

![Neohabitat Splash Screen](https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/neohabitat_splash.png)

Major thanks to **Gary Lake-Schaal** who developed our custom loader and built the original Habitat client from the original 1985 source!

At this point, **Press Enter** then enter your username:

![Neohabitat Login](https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/launcher_login.png)

**Press Enter again**, then wait until the Habitat client loads and asks you to insert your imagery disk:

![Habitat Imagery Disk Step](https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/habitat_imagery.png)

At this point, **Press Alt-n or ⌘-n**, then **Press Enter**.

If all goes well, you'll materialize in downtown Populopolis:

![Avatar In Populopolis](https://raw.githubusercontent.com/frandallfarmer/neohabitat-doc/master/docs/images/neohabitat_downtown.png)

### Step 3 - Learn How to Play

Welcome to NeoHabitat! There's a whole lot you can do here and thousands of exotic places to visit.

Before you go anywhere, **we highly recommend opening up our [Docent support software](http://habitat.themade.org)**. It's a browser based guide that'll help you navigate NeoHabitat, learn the controls and teach you about the history of the world. It's interactive and will update as you move around without you having to lift a finger.

If you are using one of the browser clients above, the Docent support software is already active!

To learn about all the things you can do in more detail, read the [official Habitat manual](https://frandallfarmer.github.io/neohabitat-doc/docs/Avatar%20Handbook.html) from 1988.

Your default controls for NeoHabitat are mapped to the numpad and Right-CTRL.

* Right-Ctrl + Numpad 8 initiates the **"GO"** command
* Right-Ctrl + Numpad 2 initiates the **"DO"** comamnd
* Right-Ctrl + Numpad 6 initiates the **"GET"** command
* Right-Ctrl + Numpad 4 initiates the **"PUT"** command

There is also a [NeoHabitat Controls cheat sheet](https://github.com/StuBlad/neohabitat-installer/blob/master/Neohabitat/NeoHabitatControls.pdf) which tells you all of the keys you need to know. 

For the most authentic experience, you'll also need to **hook up a joystick**, whether it's physical or virtual. To set one up, **open the Settings menu** then select **Joystick**. Habitat expects a joystick in **port #1**.

We have tested with various different gamepads that all work fine with Habitat. We have personally tested it with the Xbox 360 Wireless Controller for PC.

### Step 4 (Optional) - Controls

If you don't own a joystick and wish to change the controls to suit your needs then follow these steps:

- At the top of your VICE emulator, select "Settings"
- Hover your mouse over "Joystick Settings" and then select "Joystick Settings..." (Windows) or "Joystick" (OS X)
- A window should now popup saying "Joystick settings"
- For "Joystick #1", select "Keyset A"
- Click "Configure Keyset A" (Windows) or "Keyset" (OS X) and map the controls to whatever you like
- If you are running into issues, head on over to the #troubleshooting channel [on our Discord](https://discord.gg/rspcX27Vt4)
- If you have a **localized keyboard** (e.g. German QWERTZ) you might not be able to find some essential keys, like ":". It might help if you change "Settings - Keyboard Settings - Active Keymap" from Symbolic to Positional, the keyboard will behave like a C64 keyboard. 

Help!
-----

If you're having trouble getting NeoHabitat working, don't worry, we're here to help! Come [join our Discord](https://discord.gg/rspcX27Vt4) and join our **#troubleshooting** room.

If you encounter a glitch whilst playing NeoHabitat, please check to see if it's been filed as an [issue](https://github.com/frandallfarmer/neohabitat/issues). If it hasn't, we'd appreciate it if you let us know what happened so we can investigate.

Experiments
-----------

Beyond the standard clients there's a growing family of experimental clients, agents, and tools — including **[Sagebot](docs/sagebot.md)**, our LLM-driven resident; the **[3D diorama client](docs/webclient3d.md)**; and the **[text-only terminal client](textclient/README.md)**.

👉 **[docs/experiments.md](docs/experiments.md)**

Developer & Operator Documentation
----------------------------------

If you'd like to contribute to NeoHabitat, there are plenty of great opportunities!

  - **[Run your own server](docs/run-your-own-server.md)** — the full stack (Elko + `bridge_v2` + web clients + bots) via Docker Compose.
  - [The web client](docs/webclient.md) and its [design doc](webclient/DESIGN.md).
  - [PROTOCOL.md](PROTOCOL.md) — the Habitat/Elko wire protocol reference.
  - [Developer Wiki](https://github.com/frandallfarmer/neohabitat/wiki/Developers-Documentation)

In-repo clients and libraries (besides the elko server in `src/` and the Go `bridge_v2/`):

  - [`textclient/`](textclient/README.md) — a human, text-only terminal client: narrates the world and takes verb-first commands (`GO`/`GET`/`SAY`/…).
  - [`habibots/`](habibots/README.md) — in-world bots (including the LLM-driven [`sagebot`](docs/sagebot.md)), built on the `HabiBot` connection + world-model layer.
  - [`habiworld/`](habiworld/README.md) — the canonical client-side world model and 1986-faithful behavior dispatcher that the clients and bots share.
  - [`habisound/`](habisound/README.md) — plays Habitat's original C64 SID sound effects in the browser, live, from the 1986 `sfx.m` driver bytecode (a client-side consumer of `habiworld`'s sound events). [Soundboard demo](https://frandallfarmer.github.io/neohabitat-doc/docs/sounds/).
  - [`regionator/`](regionator/README.md) — compile `.rdl` region description files into NeoHabitat JSON regions.

Clients and bots connect through `bridge_v2` (port 2026), never to the elko server directly.

Have Fun!
---------

On behalf of the entire NeoHabitat Project, we hope that you have a great time, and we'll see you in-world!
