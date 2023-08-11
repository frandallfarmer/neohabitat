NeoHabitat.org: The Neoclassical Habitat Server Project
=======================================================

[![license](https://img.shields.io/github/license/mashape/apistatus.svg)](https://github.com/frandallfarmer/neohabitat/blob/master/LICENSE)
[![Twitter Follow](https://img.shields.io/twitter/follow/NeoHabitatProj.svg?style=social&label=Follow)](https://twitter.com/NeoHabitatProj)
[![Slack](https://img.shields.io/badge/slack-http%3A%2F%2Fslack.neohabitat.org-brightgreen)](http://slack.neohabitat.org/)

We're recreating [Habitat](https://en.wikipedia.org/wiki/Habitat_(video_game)), the world's first MMO, using modern technology.  We'd love it if you joined us!

Play Habitat Now!
-----------------

We maintain a demo server running the latest NeoHabitat code and you can connect to it at any time. There's often a few members of the regular crew hanging out there, so come say hey!

**Please note**: NeoHabitat is still in development, so there will likely be some instability. If you see anything weird, please [tell us about it in our Slack](http://slack.neohabitat.org/).

With all that out of the way, here's how to get started:

- If you want to use Habitat with a real C64, please switch over to [these instructions](https://github.com/frandallfarmer/neohabitat/blob/master/README-RealC64.md) for making disks and using modern connection hardware.

- You can also use our [web based client](http://habitat.themade.org) to connect via a browser. Just skip to **Step 2** below to learn how to get ingame.

### Step 1 - Download and Install either the Windows or OSX Habitat package (which comes with VICE, the C64 emulator)

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
  `x64 -rsuser -rsuserdev 0 -rsdev1 '|nc 20.3.249.92 1986' -rsuserbaud 1200 -flipname fliplist-C64.vfl Habitat-Boot.d64`
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

If you are using the web based client mentioned earlier, the Docent support software is already active!

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
- If you are running into issues, head on over to the #troubleshooting channel [on our Slack](http://slack.neohabitat.org)
- If you have a **localized keyboard** (e.g. German QWERTZ) you might not be able to find some essential keys, like ":". It might help if you change "Settings - Keyboard Settings - Active Keymap" from Symbolic to Positional, the keyboard will behave like a C64 keyboard. 

Help!
-----

If you're having trouble getting NeoHabitat working, don't worry, we're here to help! Come [join our Slack](http://slack.neohabitat.org) and join our **#troubleshooting** room.

If you encounter a glitch whilst playing NeoHabitat, please check to see if it's been filed as an [issue](https://github.com/frandallfarmer/neohabitat/issues). If it hasn't, we'd appreciate it if you let us know what happened so we can investigate.

Developer Documentation
-----------------------

If you'd like to contribute to NeoHabitat, there are plenty of great opportunities! Come check our our extensive developer documentation:

  - [Getting Started for Developers](https://github.com/frandallfarmer/neohabitat-doc/blob/master/docs/getting_started.md)
  - [Developer Wiki](https://github.com/frandallfarmer/neohabitat/wiki/Developers-Documentation)

Have Fun!
---------

On behalf of the entire NeoHabitat Project, we hope that you have a great time, and we'll see you in-world!
