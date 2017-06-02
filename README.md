NeoHabitat.org: The Neoclassical Habitat Server Project
=======================================================

[![Build Status](https://travis-ci.org/frandallfarmer/neohabitat.svg?branch=master)](https://travis-ci.org/frandallfarmer/neohabitat)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)](https://github.com/frandallfarmer/neohabitat/blob/master/LICENSE)
[![Twitter Follow](https://img.shields.io/twitter/follow/NeoHabitatProj.svg?style=social&label=Follow)](https://twitter.com/NeoHabitatProj)
[![Slack](http://slack.neohabitat.org/badge.svg)](http://slack.neohabitat.org/)

We're recreating [Habitat](https://en.wikipedia.org/wiki/Habitat_(video_game)), the world's first MMO, using modern technology.  We'd love it if you joined us!

Play Habitat Now!
-----------------

We maintain a demo server running the latest Neohabitat code and you can connect to it at any time. There's often a few members of the regular crew hanging out there, so come say hey!

**Please note**: Neohabitat is currently in alpha, so there will likely be some instability. If you see anything weird, please [tell us about it in our Slack](http://slack.neohabitat.org/).

With all that out of the way, here's how to get started:

### Step 1 - Download and Install either the Windows or OSX Habitat package (which comes with VICE, the C64 emulator)

**Windows**

- Download [Neohabitat.zip](https://github.com/frandallfarmer/neohabitat-doc/blob/master/installers/Neohabitat.zip?raw=true)

- Unzip onto the desktop
	- This is not yet an installer. Want to help build one? Join us at http://slack.neohabitat.org
	
- Open the Neohabitat folder

- Double-click the **= Launch Habitat =** icon.
	- If double clicking on the launcher does not work, try running it as administrator. If you are still encountering issues then 		scroll down to the "Help!" section of the readme for other alternatives.
	
	
**OS X**

Download the [Neohabitat DMG](https://s3.amazonaws.com/ssalevan/Neohabitat.dmg) then drag the Neohabitat application to the **Applications** folder.

The OS X application bundles all Habitat disks, so simply **launch the Neohabitat application** you dragged to **Applications**.

**Please Note**: OS X may inform you that this app comes from an unknown developer upon first launch. If this happens, **open System Preferences** and click **Security & Privacy**. From the following pane, click **Open Anyway** to launch the Neohabitat application.

### Step 2 - Login and play!

In a few moments, you'll be brought to the Neohabitat splash screen:

![Neohabitat Splash Screen](https://s3.amazonaws.com/ssalevan/neohabitat/neohabitat_splash.png)

Major thanks to **Gary Lake-Schaal** who developed our custom loader and built the original Habitat client from the original 1985 source!

At this point, **Press Enter** then enter your username:

![Neohabitat Login](https://s3.amazonaws.com/ssalevan/neohabitat/launcher_login.png)

**Press Enter again**, then wait until the Habitat client loads and asks you to insert your imagery disk:

![Habitat Imagery Disk Step](https://s3.amazonaws.com/ssalevan/neohabitat/habitat_imagery.png)

At this point, **Press Alt-n or ⌘-n**, then **Press Enter**.

If all goes well, you'll materialize in downtown Populopolis:

![Avatar In Populopolis](https://s3.amazonaws.com/ssalevan/neohabitat/neohabitat_downtown.png)

### Step 3 - Learn How to Play

Welcome to Neohabitat! There's a whole lot you can do here and thousands of exotic places to visit.

To learn about all the things you can do, read the [official Habitat manual from 1988](https://frandallfarmer.github.io/neohabitat-doc/docs/Avatar%20Handbook.html).

You'll also need to hook up a joystick, whether it's physical or virtual. To set one up, **open the Settings menu** then select **Joystick**. Habitat expects a joystick in **port #1**. Your default controls for Habitat are mapped to the numpad and Right-CTRL.

	Right-Ctrl + Numpad 8 initiates the "GO" command
	Right-Ctrl + Numpad 2 initiates the "DO" comamnd
	Right-Ctrl + Numpad 6 initiates the "GET" command
	Right-Ctrl + Numpad 4 initiates the "PUT" command

### Step 4 (Optional) - Controls

If you don't own a joystick and wish to change the controls to suit your needs then follow these steps.

	At the top of your VICE emulator select "Settings"
	Hove your mouse over "Joystick Settings" and then select "Joystick Settings..." (Minor differences, I know)
	A window should now popup saying "Joystick settings"
	For "Joystick #1" select "Keyset A"
	Then click "Configure Keyset A" and map the controls whatever you like.
	If you are stil suffering issues then please head on over to the #troubleshooting channel on the Slack.
	
	

Help!
-----

If you're having trouble getting Neohabitat working, don't worry, we're here to help! Come [join our Slack](http://slack.neohabitat.org) and join our **#troubleshooting** room.

If running the file as administrator does not work then double click on the file named "x64" to start the VICE emulator. Then drag and drop the "Habitat-Boot.d64" file onto the emulator and procede as normally.

If you encounter a glitch that's unreported in Habitat please open an issue at https://github.com/frandallfarmer/neohabitat/issues.

Developer Documentation
-----------------------

If you'd like to contribute to Habitat, there are plenty of great opportunities! Come check our our extensive developer documentation:

  - [Getting Started for Developers](https://github.com/frandallfarmer/neohabitat-doc/blob/master/docs/getting_started.md)
  - [Developer Wiki](https://github.com/frandallfarmer/neohabitat/wiki/Developers-Documentation)

Have Fun!
---------

On behalf of the entire Neohabitat Project, we hope that you have a great time, and we'll see you in-world!
