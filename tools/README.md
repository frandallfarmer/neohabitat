# NeoHabitat Tools Readme

## Vice login driver
This directory features tools related to the browser version of VICE that NeoHabitat uses in conjunction with the Docent web companion.

## generateBookOfRecords.js
This is a file that generates the NeoHabitat book of records from the database and is intended to be run as a batch job periodically (at least once a day).

## welcomebot.service
This is a systemd service file intended to make bringing the NeoHabitat Hatchery/Welcome bot online easier and use daemonization to keep downtime to a minimum.

To use this service file, copy it to __*/etc/systemd/system*__. This directory may be different on your system, but was tested using Ubuntu 20.04.6 LTS focal.

Before you can use the service, you need to modify the filepaths within accordingly. Here's what you need to change.

* **ExecStart** - This needs to be modified to point to your NeoHabitat root directory, the host you are running NeoHabitat on and the port you are running NeoHabitat on.

* **Environment** - This needs to have the correct filepath to wherever you have `Node` installed on your system. In Ubuntu, you can find this out by using the command `whereis node`.

* **WorkingDirectory** - This needs to be modified to point to your NeoHabitat root directory.

To administer the bot service, use the following commands:

* To bring the bot online, type in `sudo systemctl start welcomebot`
* To check if it's working try using `sudo systemctl status welcomebot`
* To disable your bot use `sudo systemctl stop welcomebot`
* To view error logs, use `journalctl -u welcomebot`

## elizabot.service
This is a systemd service file intended to make bringing the NeoHabitat Eliza bot online easier and use daemonization to keep downtime to a minimum.

To use this service file, copy it to __*/etc/systemd/system*__. This directory may be different on your system, but was tested using Ubuntu 20.04.6 LTS focal.

Before you can use the service, you need to modify the filepaths within accordingly. Here's what you need to change.

* **ExecStart** - This needs to be modified to point to your NeoHabitat root directory, the host you are running NeoHabitat on and the port you are running NeoHabitat on. You can also modify the region that this bot will appear in if you would like, currently it will spawn at the Fountain in the center of downtown Populopolis.

* **Environment** - This needs to have the correct filepath to wherever you have `Node` installed on your system. In Ubuntu, you can find this out by using the command `whereis node`.

* **WorkingDirectory** - This needs to be modified to point to your NeoHabitat root directory.

To administer the bot service, use the following commands:

* To bring the bot online, type in `sudo systemctl start elizabot`
* To check if it's working try using `sudo systemctl status elizabot`
* To disable your bot use `sudo systemctl stop elizabot`
* To view error logs, use `journalctl -u elizabot`
