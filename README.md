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

### Step 1 - Download and Configure a C64 Emulator

To connect to the Neohabitat server, you'll need to install a C64 emulator and download the necessary client software.  We strongly recommend using [Vice](http://vice-emu.sourceforge.net/):

**Windows**

Download the latest Windows Vice emulator from the above link then make the following configuration changes:

- Go to **Settings –> RS232 Settings**:
  - Set **RS232 Device 1** to the following: **52.87.109.252:1986**

- Go to **Settings –> Cart I/O Settings –> RS232 Userport settings**:
  - Enable **RS232 Userport** and **Userport Device RS232 Device 1**
  - Set **Userport baud rate** to the following: **1200**

**OS X**

Download the [Neohabitat DMG](https://s3.amazonaws.com/ssalevan/Neohabitat.dmg) then drag the Neohabitat application to the **Applications** folder.

### Step 2 - Download the Neohabitat Client

**If you're running OS X, you can skip this step.**

The Neohabitat client software can be downloaded here:

- [Habitat Loader](http://cloud.cbm8bit.com/brataccas/Habitat-Boot.d64)
- [Habitat disk B (a.k.a. Imagery)](https://s3.amazonaws.com/ssalevan/neohabitat/Habitat-B.d64)

Major thanks to **Gary Lake-Schaal** who developed our custom loader and built the original Habitat client from the original 1985 source!

### Step 3 - Run Neohabitat

**Windows**

Insert the **Habitat-Boot.d64** into **Drive 8** via **File->Attach Disk Image->Unit #8**. After insertion, run the following BASIC command:

```
LOAD"*",8,1
```

You'll see the following messages:

```
SEARCHING FOR *
LOADING
READY.
```

After these messages conclude, run the following BASIC command:

```
RUN
```

In a few moments, you'll be brought to the Neohabitat splash screen:

![Neohabitat Splash Screen](https://s3.amazonaws.com/ssalevan/neohabitat/neohabitat_splash.png)

At this point, **press Enter** then enter your username:

![Neohabitat Login](https://s3.amazonaws.com/ssalevan/neohabitat/launcher_login.png)

**Press enter again**, then wait until the Habitat client loads and asks you to insert your imagery disk:

![Habitat Imagery Disk Step](https://s3.amazonaws.com/ssalevan/neohabitat/habitat_imagery.png)

At this point, insert the **Habitat-B.d64** disk into **Drive 8** via **File->Attach Disk Image->Unit #8** then **press Enter**.

If all goes well, you'll materialize in downtown Populopolis:

![Habitat Start Screen](https://s3.amazonaws.com/ssalevan/neohabitat/habitat_start.png)

**OS X**

The OS X application bundles all Habitat disks, so simply **launch the Neohabitat application** you dragged to Applications.

**Please Note**: OS X may inform you that this app comes from an unknown developer upon first launch. If this happens, **open System Preferences** and click **Security & Privacy**. From the following pane, click **Open Anyway** to launch the Neohabitat application.

In a few moments, you'll be brought to the Neohabitat splash screen:

![Neohabitat Splash Screen](https://s3.amazonaws.com/ssalevan/neohabitat/neohabitat_splash.png)

At this point, **press Enter** then enter your username:

![Neohabitat Login](https://s3.amazonaws.com/ssalevan/neohabitat/launcher_login.png)

**Press enter again**, then wait until the Habitat client loads and asks you to insert your imagery disk:

![Habitat Imagery Disk Step](https://s3.amazonaws.com/ssalevan/neohabitat/habitat_imagery.png)

This disk is **stored within your VICE Fliplist**, so simply **press ⌘-n to load up the next disk**, then **press Enter**.

If all goes well, you'll materialize in downtown Populopolis:

![Avatar In Populopolis](https://s3.amazonaws.com/ssalevan/neohabitat/neohabitat_downtown.png)

### Step 4 - Learn How to Play

Welcome to Neohabitat! There's a whole lot you can do here and thousands of exotic places to visit.

To learn about all the things you can do, read the [official Habitat manual from 1988](https://frandallfarmer.github.io/neohabitat-doc/docs/Avatar%20Handbook.html).

You'll also need to hook up a joystick, whether it's physical or virtual. To set one up, **open the Settings menu** then select **Joystick**. Habitat expects a joystick in **port #1**.

Help!
-----

If you're having trouble getting Neohabitat working, don't worry, we're here to help! Come [join our Slack](http://slack.neohabitat.org) and join our **#troubleshooting** room.

Developer Documentation
-----------------------

If you'd like to contribute to Habitat, there are plenty of great opportunities! Come check our our extensive developer documentation:

  - [Getting Started for Developers](https://github.com/frandallfarmer/neohabitat-doc/blob/master/docs/getting_started.md)
  - [Developer Wiki](https://github.com/frandallfarmer/neohabitat/wiki/Developers-Documentation)

Have Fun!
---------

On behalf of the entire Neohabitat Project, we hope that you have a great time, and we'll see you in-world!
