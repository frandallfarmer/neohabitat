# C64 clients — VICE, Ultimate 64, and real hardware

The Habitat client is genuine 1986 C64 software (rebuilt from the original
Lucasfilm source by **Gary Lake-Schaal**). You can run it three ways: in the
**VICE** emulator, on an **Ultimate 64**, or on a **real Commodore 64**.

All of them connect to the public server at **`habitat.themade.org` port `1986`**
(the classic-client port on `bridge_v2`, the protocol bridge — see
[run-your-own-server.md](run-your-own-server.md) to point them at your own server instead).

> Don't want to install anything? The same C64 client runs in your browser at
> **[habitat.themade.org](http://habitat.themade.org/)** — see [play.md](play.md).

## VICE

The emulator packages bundle VICE preconfigured with the Habitat disks.

### Windows

1. Download the [NeoHabitat installer](https://github.com/StuBlad/neohabitat-installer/releases/download/1.1/NeoHabitatInstaller1.1.exe) and run it
   (tested on Windows 11; older versions should be fine).
2. Check **Launch NeoHabitat** at the end of the install, or use the desktop /
   Start Menu icon.

### macOS

1. Download [Neohabitat.dmg](https://github.com/frandallfarmer/neohabitat-doc/blob/master/installers/Neohabitat.dmg?raw=true) and open it.
2. Drag **NeoHabitat** to **Applications** and launch it.
   If macOS objects to an unknown developer, use **System Preferences →
   Security & Privacy → Open Anyway**.

### Linux and *BSD

1. Install VICE and `nc` (netcat) from your package manager.
2. Extract [Neohabitat.zip](https://github.com/frandallfarmer/neohabitat-doc/blob/master/installers/Neohabitat.zip?raw=true) for the `.d64` files and `fliplist-C64.vfl`.
3. Run:

   ```sh
   x64 -rsuser -rsuserdev 0 -rsdev1 '|nc habitat.themade.org 1986' \
       -rsuserbaud 1200 -flipname fliplist-C64.vfl Habitat-Boot.d64
   ```

> **VICE version note:** current VICE releases have a bug that breaks this
> network support ([vice-emu bug #1356](https://sourceforge.net/p/vice-emu/bugs/1356)).
> Versions up to and including **r38928** work.

### First login (all VICE platforms)

At the splash screen **press Enter**, type your avatar name, **Enter** again;
when asked for the imagery disk press **Alt-n** (⌘-n on Mac), then **Enter** —
and you'll materialize in downtown Populopolis. Full walkthrough with
screenshots in the [main README](../README.md#step-2---login-and-play).

Controls, joystick, and keyset remapping: [README Steps 3–4](../README.md#step-3---learn-how-to-play).

## Ultimate 64

Run the client natively on an **Ultimate 64** (or a stock C64 fitted with an
**Ultimate II/II+ cartridge**) over your home network — HDMI or composite out,
no floppies, no modem. You copy a cartridge image + modem config to the U64,
save the config to flash once, and run it from the U64 menu.

**The authoritative setup guide lives in the habiclient repo:**
👉 **[ssalevan/habiclient — U64.md](https://github.com/ssalevan/habiclient/blob/main/docs/U64.md)**

It covers firmware requirements (3.11+), file transfer (USB/FTP), the modem
configuration, connecting to the public server or your own, troubleshooting,
and how it all works.

## Real C64

Original hardware: a C64/C128, a 1541 drive (or 1541 Ultimate / SD2IEC), disks
made from our D64 images, and a userport WiFi modem.

👉 **[README-RealC64.md](../README-RealC64.md)** — the full guide: supported
transfer/modem hardware, disk images, connection strings, and hard-won tips.
