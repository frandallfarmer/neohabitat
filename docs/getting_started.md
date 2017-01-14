Getting Started
===============

We're rebuilding the world's first MMO, brick by brick, and we're over the moon to have you on board.  We wanted to make it fast and easy to get started, and in our experience you can go from nothing to a fully-functional development environment in under 20 minutes.  Simply follow this guide and you'll be on your way to contributor status before you know it.

Overview
--------

There are five services that must be set up to run Neohabitat:

- Neohabitat server (based on [Elko](https://github.com/FUDCo/Elko))
- Neohabitat-to-Habitat protocol bridge (converts Neohabitat messages into binary packets compatible with the QuantumLink protocol)
- [MongoDB](https://www.mongodb.com/) (to persist Neohabitat data)
- [QuantumLink Reloaded server](https://github.com/ssalevan/qlink) (reconstructs the original 1980s [QuantumLink](https://en.wikipedia.org/wiki/Quantum_Link) service, proxying Habitat packets to Commodore 64 clients)
- [MySQL](https://www.mysql.com/) (to persist QuantumLink Reloaded data)

To expedite the setup procedure, we've created a [Docker Compose](https://docs.docker.com/compose/) setup script which will establish these services and provide for swift iteration.

Step 1 - Install Docker
-----------------------

To take advantage of the Neohabitat automation, you'll need to install Docker and Docker Compose.  You can do so by following one of the following guides:

- [Docker for Mac](https://docs.docker.com/docker-for-mac/)
- [Docker for Windows](https://docs.docker.com/docker-for-windows/)
- [Docker for Ubuntu](https://docs.docker.com/engine/installation/linux/ubuntulinux/)
- [Docker for CentOS](https://docs.docker.com/engine/installation/linux/centos/)
- [Docker for Fedora](https://docs.docker.com/engine/installation/linux/fedora/)

Step 2 - Build and Start Neohabitat Services
--------------------------------------------

Now that you've installed Docker, you can trigger the Neohabitat launch process with a single command:

```bash
docker-compose up
```

Docker Compose will proceed to pull the images for all dependent services then launch the Neohabitat build process.  This will take approximately 10 minutes upon the first build; all subsequent launches will be near-instantaneous.  You'll see the following log output when this process has completed:

```
qlink_1       | 2017-01-14 08:47:49,035 [main] INFO  org.jbrain.qlink.QLinkServer  - Starting server
qlink_1       | 2017-01-14 08:47:49,065 [main] INFO  org.jbrain.qlink.QLinkServer  - Listening on 0.0.0.0:5190
qlink_1       | 2017-01-14 08:47:49,089 [main] DEBUG org.jbrain.qlink.chat.RoomManager  - Creating default Lobby
qlink_1       | 2017-01-14 08:47:49,094 [main] DEBUG org.jbrain.qlink.chat.AbstractRoomDelegate  - Creating locked public room: Lobby
qlink_1       | 2017-01-14 08:47:49,096 [main] DEBUG org.jbrain.qlink.chat.RoomManager  - Adding room 'Lobby' to public room list
qlink_1       | 2017-01-14 08:47:49,101 [main] DEBUG org.jbrain.qlink.chat.RoomManager  - Creating Auditorium
qlink_1       | 2017-01-14 08:47:49,106 [main] DEBUG org.jbrain.qlink.chat.AbstractRoomDelegate  - Creating locked private room: Auditorium
qlink_1       | 2017-01-14 08:47:49,112 [main] DEBUG org.jbrain.qlink.chat.RoomManager  - Adding room 'Auditorium' to private room list
```

Docker Compose will proxy the following service ports to localhost:

- **1337**: Habitat protocol bridge
- **3307**: MariaDB (open source MySQL) server
- **5190**: QuantumLink Reloaded server
- **9000**: Neoclassical Habitat Elko server
- **27017**: MongoDB server

The Neohabitat repository will be linked into the /neohabitat directory of the 'neohabitat' container.  You can get to a Bash console on this container (based on EL7) by running the following command:

```bash
docker-compose exec neohabitat /bin/bash
```

Step 3 - Download and Configure Vice
------------------------------------

To test Commodore 64 behavior, you'll need to install a C64 emulator and download the necessary client software.  We strongly recommend using [Vice](http://vice-emu.sourceforge.net/), as it has an active upstream and allows you to connect its emulated serial ports to the stdin/stdout of an external process.

**Windows**

Download the latest Windows Vice emulator from the above link then make the following configuration changes:

- Go to Settings –> RS232 Settings:
  - Set RS232 Device 1 to the following: 127.0.0.1:5190
- Go to Settings –> Cart I/O Settings –> RS232 Userport settings:
  - Enable RS232 Userport and Userport Device RS232 Device 1
  - Set Userport baud rate to the following: 1200

**OS X**

Newer versions of Vice are not compatible with QuantumLink, so be sure to download **version 2.4** of the **Cocoa UI variant**.  Once you've done so, open the DMG and follow this configuration procedure:

- Drag the x64 application from the Vice D64 to your Applications folder
- Establish a shell alias in your ~/.bashrc or ~/.zshrc to force the enabling of the RS232 userport:

```bash
alias c64='/Applications/x64.app/Contents/MacOS/x64 -rsuser -rsuserbaud 1200 -rsuserdev 0'
```

- Launch Vice via the above alias then go to Settings -> Resource Inspector
- Under Peripherals -> RS232, set Device 1 to the following: ```|nc 127.0.0.1 5190```
- Under Peripherals -> RS232, set Device 1 Baud Rate to the following: ```1200```
- Save these new settings via Settings -> Save current Settings

Step 4 - Download the C64 Clients
---------------------------------

Client software can be downloaded here:

- [QuantumLink (with Habitat support)](https://s3.amazonaws.com/ssalevan/neohabitat/QuantumLink.d64)
- [Club Caribe (disk A/side 3)](https://s3.amazonaws.com/ssalevan/neohabitat/club-caribe-a.d64)
- [Club Caribe (disk B/Imagery)](https://s3.amazonaws.com/ssalevan/neohabitat/club-caribe-b.d64)

The Club Caribe client software is identical to the Habitat software, so please note this as we continue.

Step 5 - Connect to QuantumLink Reloaded
----------------------------------------

Load the QuantumLink D64 image you just downloaded into Unit #8 of your emulated C64.  You can do so via File->Attach Disk Image->Unit #8.

After the QuantumLink disk is loaded, you can start it by running the following C64 command:

```
LOAD"*",8,1
```

Eventually, you'll be brought to a screen that asks you to establish your initial modem settings.  You can use the arrow keys and enter to select each configuration field; use the following settings:

- Modem: **Other command driven modems**
- Speed: **1200 Baud**
- Dial: **Automatic**
- Phone: **Tone**
- Number: **+5551212**

After finishing this process, select **SIGN ON TO Q-LINK**.  You'll be brought to a green-framed screen which states ```Type commands to the modem, then press F1 when connection is made.```.  Press F1, and if all goes well, your client will connect to QuantumLink Reloaded and present you with a set of registration prompts.  Enter the information prompted and remember your username; you'll need it later.

When this task is complete, you'll be brought to the QuantumLink home screen; it'll look something like this:

![QuantumLink Home Screen](http://toastytech.com/guis/c64gquantumlink.gif)

Step 6 - Launch Habitat
-----------------------

On the Commodore 64, the function keys were placed prominently to the right of the main keyboard and were used heavily by many applications.  As a result, much of the navigation you'll use within QuantumLink will depend on the usage of function keys.  You'll use the following keys during your QuantumLink experience:

- **F1** - Selects whatever is highlighted
- **F5** - Goes back, similar to the back button in a web browser
- **F7** - Brings up a department menu

When you reach the QuantumLink home screen again, ensure that the selector is placed over **People Connection** then press **F1**.  There will be a short load period which will lead you to the People Connection screen.  After reaching this screen, press **F7** to bring up the department menu.  Select **Play or observe an online game** and press **F1**.  Select **Start a game (pick your partners)** and press **F1** again.

Finally, select **Club Caribe** from the list and press **F1** one last time.

You'll be asked to insert Game Disk 3, which is Club Caribe Disk A (club-caribe-a.d64).  Attach this disk using the above procedure and hit Enter.  After doing so, you can engage Warp Mode to expedite the load process.

Eventually, you'll reach a screen that looks something like this:

![QuantumLink Home Screen](http://vzn.eddcoates.com/clubcaribe/sitepics/ClubCarFront.gif)

You'll be asked to insert the Imagery Disk, which is Club Caribe Disk B (club-caribe-b.d64).  Attach this disk using the above procedure and hit Enter.  You can engage Warp Mode here as well.

If all goes well, you'll be brought to the first Habitat screen.  If so, congratulations!

Step 7 - Build Neohabitat locally to enable IDE integration
-----------------------------------------------------------

The Neohabitat build scripting will install necessary dependency JARs that are not present in Maven Central; to enable IDE support, simply run a local build:

```bash
./build
```

After doing so, you'll be able to import the root pom.xml into Eclipse or IntelliJ to gain full IDE integration.

Conclusion
----------

We hope that this guide helped you to get acquainted with Neohabitat and its services and we're looking forward to working with you!  If you have any questions or concerns, feel free to ask them in the [Neohabitat Slack](https://neohabitat.slack.com/).

Have fun!
