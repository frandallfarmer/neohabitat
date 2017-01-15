Getting Started
===============

We're rebuilding the world's first MMO, brick by brick, and we're over the moon to have you on board.  We wanted to make it fast and easy to get started, and in our experience you can go from nothing to a fully-functional development environment in under 20 minutes.  Simply follow this guide and you'll be on your way to contributor status before you know it.

Overview
--------

There are five services that must be established to run Neohabitat:

- Neohabitat server (based on [Elko](https://github.com/FUDCo/Elko))
- Neohabitat-to-Habitat protocol bridge (converts Neohabitat messages into binary packets compatible with the QuantumLink protocol)
- [MongoDB](https://www.mongodb.com/) (to persist Neohabitat data)
- [QuantumLink Reloaded server](https://github.com/ssalevan/qlink) (reconstructs the original 1980s [QuantumLink](https://en.wikipedia.org/wiki/Quantum_Link) service, proxying Habitat packets to Commodore 64 clients)
- [MySQL](https://www.mysql.com/) (to persist QuantumLink Reloaded data)

To expedite the setup procedure, we've created a [Docker Compose](https://docs.docker.com/compose/) setup script which will setup these services and provide for swift iteration.

Step 1 - Install Docker
-----------------------

To take advantage of the Neohabitat automation, you'll need to install Docker and Docker Compose.  You can do so by following one of the following guides:

**Windows**

If you're currently running **Windows 10 Professional/Enterprise/Education**, you can use Docker for Windows, which will streamline the setup experience:

- [Docker for Windows](https://docs.docker.com/docker-for-windows/)

Next, follow the Docker variant of Step 2.

If you're not running one of these Windows versions, you can use the Vagrant setup procedure, which will work on all others **(7/8/10 Home)**.  Download and install the **latest versions** of the following programs:

- [Vagrant](https://www.vagrantup.com/downloads.html)
- [VirtualBox](https://www.virtualbox.org/wiki/Downloads)

Next, follow the Vagrant variant variant of Step 2.

**OS X**

Follow the instructions here:

- [Docker for Mac](https://docs.docker.com/docker-for-mac/)

Next, follow the Docker variant of Step 2.

**Linux**

Follow the instructions here:

- [Docker for Ubuntu](https://docs.docker.com/engine/installation/linux/ubuntulinux/)
- [Docker for CentOS](https://docs.docker.com/engine/installation/linux/centos/)
- [Docker for Fedora](https://docs.docker.com/engine/installation/linux/fedora/)

Next, follow the Docker variant of Step 2.

Step 2 - Build and Start Neohabitat Services (with Docker)
----------------------------------------------------------

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

If you wish to restart the Neohabitat server after making a code change, be certain that you've built a new JAR locally via the ```./build``` command then restart Neohabitat with the following command:

```bash
docker-compose restart neohabitat
```

Step 2 - Build and Start Neohabitat Services (with Vagrant)
-----------------------------------------------------------

Open a **standard Windows command line (cmd.exe, not Bash or PowerShell)** and navigate via ```cd``` to the location of your Neohabitat checkout.  Run the following command:

```bash
vagrant plugin install vagrant-reload
vagrant plugin install vagrant-docker-compose
vagrant up --provider=virtualbox
```

Vagrant will proceed to download the Ubuntu image, launch it, then install Docker and run the docker-compose build step.

After the build procedure has concluded, you can develop and build new artifacts on your local machine and they will be synced through to Docker.  Furthermore, the following service ports will be forwarded to your local environment:

- **1337**: Habitat protocol bridge
- **3307**: MariaDB (open source MySQL) server
- **5190**: QuantumLink Reloaded server
- **9000**: Neoclassical Habitat Elko server
- **27017**: MongoDB server

You can reach a console via the following command:

```bash
vagrant ssh
```

If you wish to restart the Neohabitat server after making a code change, be certain that you've built a new JAR locally via the ```./build``` command then restart Neohabitat with the following command:

```bash
vagrant ssh
cd /vagrant
docker-compose restart neohabitat
```

**Troubleshooting**

If all does not go well during the Vagrant provisioning step, it's likely that either Vagrant can't find VirtualBox or one of the upstream Linux package repositories is having issues.

If Vagrant returns an error like so:

```
No usable default provider could be found for your system.

Vagrant relies on interactions with 3rd party systems, known as
"providers", to provide Vagrant with resources to run development
environments. Examples are VirtualBox, VMware, Hyper-V.

If so, you may need to retry the Vagrant build process:

The easiest solution to this message is to install VirtualBox, which
is available for free on all major platforms.

If you believe you already have a provider available, make sure it
is properly installed and configured. You can see more details about
why a particular provider isn't working by forcing usage with
`vagrant up --provider=PROVIDER`, which should give you a more specific
error message for that particular provider.
```

You may need to change the value of the ```ENV["VBOX_INSTALL_PATH"]``` setting in your Vagrantfile to point to your custom VirtualBox installation.

If an error occurs during the provisioning process, simply retry the launch procedure after waiting a few minutes:

```bash
vagrant up --provider=virtualbox
```

Step 3 - Download and Configure Vice
------------------------------------

To test Commodore 64 behavior, you'll need to install a C64 emulator and download the necessary client software.  We strongly recommend using [Vice](http://vice-emu.sourceforge.net/), as it has an active upstream and allows you to connect its emulated serial ports to the stdin/stdout of an external process.

**Windows**

Download the latest Windows Vice emulator from the above link then make the following configuration changes:

- Go to **Settings –> RS232 Settings**:
  - Set **RS232 Device 1** to the following: **127.0.0.1:5190**
- Go to **Settings –> Cart I/O Settings –> RS232 Userport settings**:
  - Enable **RS232 Userport** and **Userport Device RS232 Device 1**
  - Set **Userport baud rate** to the following: **1200**

**OS X**

Newer versions of Vice are not compatible with QuantumLink, so be sure to download **version 2.4** of the **Cocoa UI variant**.  Once you've done so, open the DMG and follow this configuration procedure:

- Drag the x64 application from the Vice D64 to your Applications folder
- Establish a shell alias in your **~/.bashrc** or **~/.zshrc** to force the enabling of the RS232 userport:

```bash
alias c64='/Applications/x64.app/Contents/MacOS/x64 -rsuser -rsuserbaud 1200 -rsuserdev 0'
```

- Launch Vice via the above alias then go to **Settings -> Resource Inspector**
- Under **Peripherals -> RS232**, set **Device 1** to the following: ```|nc 127.0.0.1 5190```
- Under **Peripherals -> RS232**, set **Device 1 Baud Rate** to the following: ```1200```
- Save these new settings via **Settings -> Save current Settings**

Step 4 - Download the C64 Clients
---------------------------------

Client software can be downloaded here:

- [QuantumLink (with Habitat support)](https://s3.amazonaws.com/ssalevan/neohabitat/QuantumLink.d64)
- [Club Caribe disk A (a.k.a. side 3)](https://s3.amazonaws.com/ssalevan/neohabitat/club-caribe-a.d64)
- [Club Caribe disk B (a.k.a. Imagery)](https://s3.amazonaws.com/ssalevan/neohabitat/club-caribe-b.d64)

The **Club Caribe client software is identical to the Habitat software**, so please note this as we continue.

Step 5 - Connect to QuantumLink Reloaded
----------------------------------------

Load the QuantumLink D64 image you just downloaded into Unit #8 of your emulated C64.  You can do so via **File -> Attach Disk Image -> Unit #8**.

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

After finishing this process, select **SIGN ON TO Q-LINK**.  You'll be brought to a green-framed screen which states ```Type commands to the modem, then press F1 when connection is made.```:

![QuantumLink Connect Screen](https://s3.amazonaws.com/ssalevan/neohabitat/connect_qlink.png)

Press **F1**, and if all goes well, your client will connect to QuantumLink Reloaded and present you with a set of registration prompts.  **Enter the information prompted** and **remember your username**; you'll need it later.

When this task is complete, you'll be brought to the QuantumLink home screen; it'll look something like this:

![QuantumLink Home Screen](http://toastytech.com/guis/c64gquantumlink.gif)

Step 6 - Load MongoDB Models
----------------------------

Recall the username you entered above then create a file in the **db/** folder called **user-username.json**.  For instance, if your username was **Steve**, you'd add the following to **db/user-steve.json**:

```json
{
  "type": "user",
  "ref": "user-steve",
  "name": "Steve",
  "mods": [
    {
      "type": "Avatar",
      "x": 100,
      "y": 130,
      "bodyType": "male",
      "bankBalance": 2000,
      "custom": [68, 68],
      "nitty_bits": 8
    }
  ]
}
```

After you've completed this step, you can load all models into MongoDB by running the following commands from your Neohabitat checkout:

```bash
cd db
make db
```

You're now ready to start Habitat for the first time.

Step 7 - Launch Habitat
-----------------------

On the Commodore 64, the function keys were placed prominently to the right of the main keyboard and were used heavily by many applications.  As a result, much of the navigation you'll use within QuantumLink will depend upon the usage of function keys.  These are the ones you'll use during your QuantumLink experience:

- **F1** - Selects whatever is highlighted
- **F3** - Saves whatever you're looking at to disk (you can likely ignore this one)
- **F5** - Goes back, similar to the back button in a web browser
- **F7** - Brings up a department menu
- **Arrow Keys** - Moves the selector, whether in a menu or on the Home screen

At the QuantumLink home screen, ensure that the selector is placed over the **People Connection** department then press **F1**.  There will be a short load period which will lead you to the People Connection screen:

![QuantumLink People Connection Screen](https://s3.amazonaws.com/ssalevan/neohabitat/people_connection.png)

After reaching it, press **F7** to bring up the department menu.  Select **Play or observe an online game** with the **arrow keys** and press **F1**.  Select **Start a game (pick your partners)** with the and press **F1** again.

Finally, select **Club Caribe** from the list and press **F1** one last time.

You'll be asked to insert **Game Disk 3**, which is **Club Caribe Disk A (club-caribe-a.d64)**.  Attach this disk using the above procedure and hit **Enter**.  After doing so, you can engage Warp Mode to expedite the load process.

Eventually, you'll reach a screen that looks something like this:

![QuantumLink Home Screen](http://vzn.eddcoates.com/clubcaribe/sitepics/ClubCarFront.gif)

You'll be asked to insert the **Imagery Disk**, which is **Club Caribe Disk B (club-caribe-b.d64)**.  Attach this disk using the above procedure and hit **Enter**.  You can engage Warp Mode here as well.

If all goes well, you'll be brought to the first Habitat screen:

![Habitat Start Screen](https://s3.amazonaws.com/ssalevan/neohabitat/habitat_start.png)

If so, congratulations, you've just rebuilt Habitat!

Step 8 - Build Neohabitat Locally to Enable IDE Integration
-----------------------------------------------------------

The Neohabitat build scripting will install necessary dependency JARs that are not present in Maven Central; to enable IDE support, simply run a local build:

```bash
./build
```

After doing so, you'll be able to import the root pom.xml into Eclipse or IntelliJ to gain full IDE integration.

You'll also want to run a local build when you've completed a code change and are ready to reload Neohabitat.

Conclusion
----------

We hope that this guide helped you to get acquainted with Neohabitat and its services and we're looking forward to working with you!  If you have any questions or concerns, feel free to ask them in the [Neohabitat Slack](https://neohabitat.slack.com/).

Have fun and happy hacking!
