# Setting up a real C64 to play NeoHabitat
Guide written June 7th-29th 2017 by Goethe ([GitHub](https://github.com/napi-goethe) / [Website](http://www.carpeludum.com) / [Twitter](https://twitter.com/Goe_The)) and Flexman
with many thanks to the [NeoHabitat Slack](http://slack.neohabitat.org/) #troubleshooting and #c64 channel team: @stu, @glake1 and of course @randy

Last updated: 6/21/2023 by StuBlad to add the new NeoHabitat server address

## What hardware do you need

* A C64 (any model) or C128
* At least one floppy drive - I used a 1541-II. Tests with other drives pending.
* A **working** 5,25" floppy disk
  * Disks die over time. Please make sure you have two that are still good. I wasted one hour of the NeoHabitat launch night testing with a weak/defective disk.
* Special hardware to use D64 disk images on a real C64 or special hardware to transfer them to real C64 floppy disks. Options are:
  * Use D64 disk images on a real C64 (emulation of a real floppy drive)
    * **Tested and working:**
      * 1541 Ultimate / Ultimate II+
    * **Not tested yet:**
      * SD2IEC
  * Transfer disk images to real C64 floppy disks
    * **Tested and working:**
      * 1541 Ultimate / Ultimate II+
      * RR-Net MK3 expansion port ethernet adapter [available here from Individual Computers](https://icomp.de/shop-icomp/de/shop/product/rr-net-mk3.html)
      * XAP transfer cable other possibilities exist, but have not been tested yet - the C64 community is welcome to test and add experiences, for example:
    * **Not tested yet:**
      * Other transfer cables (XM/XA etc.)
* Special hardware for connecting the C64 to the Internet via the serial port method (user port)
  * **Tested and working:**
    * The "Australian" userport WiFi modem [available here from Melbourne Console Reproductions](http://melbourneconsolerepros.com/product_info.php?products_id=125)
    * The [Strikelink modem](https://1200baud.wordpress.com/2017/03/17/strikelink-c64-300-9600-baud-wifi-modem-on-sale/) works
  * **Not tested yet:**
    * Other C64 WiFi userport modems such as the U.S. one (cbmstuff.com)
    * RR-Net MK3 (not ready for modem connection yet, modem emulation driver would have to be programmed first)
    * Connecting the C64 to PC via RS-232 and emulating the modem via PC ([see here](http://orrtech.us/qlink/)).
    * Using a [DreamPi](http://blog.kazade.co.uk/p/dreampi.html) as gateway
    * 1541 Ultimate (not ready for modem connection yet)

## Required D64 disk images

The archive [`Neohabitat-RealC64.zip`](https://github.com/frandallfarmer/neohabitat-doc/blob/master/installers/Neohabitat-RealC64.zip) contains the exact files with which I was successful in connecting to NeoHabitat:
* `Habitat-Boot_v1.1-modemenabled.d64`
* `Habitat-B.d64`

## Guide Step 1 - Directly Use D64 images on real C64 or transfer D64 images to real C64 floppy disks

### DIRECT IMAGE USE options for step 1

#### (Option 1) DIRECT IMAGE USE using the 1541 Ultimate

* Use the D64 images (you could also use them with Vice on a PC)
* All you need is `Habitat-Boot_v1.1-modemenabled.d64` and `Habitat-B.d64`.
* Run them on your 1541-U directly
* Make sure that you only have one drive connected when you run the game. NeoHabitat won't start if you have more than one drive connected. If you have a C128 or SX64 with internal drive you have either to switch the drive or the drive emulation of the 1541-U/II+ off.

#### Using any other method

(To be written by the community, when successfully tested)

### TRANSFER options for step 1

#### (Option 1) TRANSFER using the 1541 Ultimate / II+

* Use the D64 images (you could also use them with Vice on a PC)
* All you need is `Habitat-Boot_v1.1-modemenabled.d64` and `Habitat-B.d64`
* Transfer them to disk (e.g. via disk copy utilities from the Action Cartdrige 6.0 included with your 1541-U/II+)
  * Write `Habitat-Boot_v1.1-modemenabled.d64` to side A of your real C64 disk
  * Write `Habitat-B.d64` to side B of your real C64 disk
* Make sure that you only have one drive connected when you run the game. NeoHabitat won't start if you have more than one drive connected. If you have a C128 or SX64 with internal drive you have either to switch the drive or the drive emulation of the 1541-U/II+ off.

#### (Option 2) TRANSFER using RR-Net MK3

Unfortunately, this is a hen-and-egg problem. You need **someone** to get you the C64 program `WARPCOPY06` from following step 1 to a real C64 disk, so you can continue with steps 2 and 3... Have you visited a retro computer party lately? :)

1. Get and start warpcopy06 [from CSDB here](http://csdb.dk/release/?id=147362)
2. Using warpcopy06, write `Habitat-Boot_v1.1-modemenabled.d64` to side A of your real C64 disk
3. Using warpcopy06, write `Habitat-B.d64` to side B of your real C64 disk

#### (Option 3) TRANSFER using OpenCBM's d64copy.exe and a XAP1541 cable

For this option, you need a XAP1541 cable and a PC with a parallel port (hardware) and OpenCBM (software). Writing of disk images is working with the serial part of the XAP1541 cable too (only slower), so you do not need to install a parallel cable to your 1541 disk drive (only when you want a fast transfer).

1. Get and install OpenCBM tools
2. Using d64copy, write `Habitat-Boot_v1.1-modemenabled.d64` to side A of your real C64 disk
3. Using d64copy, write `Habitat-B.d64` to side B of your real C64 disk

#### (Option 4) TRANSFER using your modem to get the files via BBS

Since you obviously have a modem for playing this game, you can connect to a Bulletin Board System which offers the game for download.
There currently isn't a BBS available that hosts the Habitat disk images but if you find one, feel free to add it to this guide!

#### Using any other method

(To be written by the community, when successfully tested)

## Guide Step 2 - Prepare the WiFi Modem for NeoHabitat

#### (Option 1) using Australian WiFi modem from Melbourne Console Reproductions

This section assumes you are familiar with the general setup of the modem according to it's user manual,
e.g. using Striketerm to issue modem commands.

1. Configure your WiFi modem to connect to your WiFi network (probably you already did that anyway)
2. For use with NeoHabitat, the modem needs to be set to 1200 baud
  * `at$sb=1200`
3. If you are lazy, you can set the NeoHabitat Q-Link server to a speed dial slot, e.g. 0:
  * `at&z0=habitat.themade.org:1986`
4. Don't forget to save the defaults
  * `at&w`

#### (Option 2) using Alwyz Strikelink modem

1. Start [CCGMS](http://csdb.dk/release/index.php?id=156523). We assume you already did your Wifi settings and initialization,
   and know how your modem works (e.g. using 9600 baud for the first command after it has been switchted on).
2. Change the baud rate to 1200 by typing "at$sb=1200". Press F7 and also change the baud rate there.
3. Type at&k0 for turning off hardware flow control
4. You could now dial the URL from the terminal, or use your phone book (press F7 and "A" for Autodialer/Phone Book)
5. Add habitat.themade.org with port 1986 to your phone book and call it from there by pressing "C". (You might want
   to exit the phone book and save it with "S" when doing this the 1st time).
6. After you modem is connected, the blue light will turn off. You can press reset and proceed with the next step.

#### Using any other method

(To be written by the community, when successfully tested)

## Guide Step 3 - Boot NeoHabitat

* Insert disk `Habitat-Boot_v1.1-modemenabled.d64`
* Type in `LOAD"*",8,1`, wait a while and then type `RUN`

* Once the client has loaded, you should see the NeoHabitat title screen.
* Press `ENTER`.
* In the following screen, you can enter your desired user name.
* If your modem already is connected, you can proceed with step 4. If your modem is not connected because you don't have a reset button, or prefer to do it from within the game, press `F7` to enter Terminal mode to issue modem commands.

#### (Option 1) using Australian WiFi modem from Melbourne Console Reproductions

Currently, it may be that modem responses are garbled, but this does not affect functionality. Just disregard it and blindly type the required modem commands.

Here, you enter the commands required to connect the "Australian" WiFi modem to the NeoHabitat server:
* `ati`
  * (modem responds with hello, and connects to your WiFi network)
* `atc1` (optional)
  * (modem connects to your WiFi network, if first connection attempt has failed, which happens quite often to me)
* `atds0`
  * (modem connects to speed dial 0, i.e. the NeoHabitat server)

Then you should see `CONNECT 1200` - then press `RUN/STOP`
If you don't see it, there may be a problem with your internet connection - or with the NeoHabitat server (it may be down from time to time).

#### (Option 1) using Strikelink modem

@flexman please add specifics for Strikelink modem here

#### Using any other method

(To be written by the community, when successfully tested)

## Guide Step 4 - Start NeoHabitat

After the modem commands have been issued and the connection to the NeoHabitat server is active and RUN/STOP has been pressed, simply press `RETURN`.

NeoHabitat has launched (some further stuff is loaded from disk).

When the message "Press Alt-N/Cmd-N" is displayed, insert or virtually-mount the Habitat-B disk.
Press `SPACE`.

After a short while, your avatar should hatch at the NeoHabitat Immigration center.

If the game stops loading before your avatar shows up, you might check your modem connection. In case the modem is not connected,
there will not be any error message, the game just will stop loading at this point.

# Enjoy NeoHabitat on your real C64!

![Goethe's real C64 connecting to Neohabitat on Launch Day](https://github.com/frandallfarmer/neohabitat-doc/blob/master/docs/images/GoetheRealC64Launchday.JPG)

And join the [Slack](https://neohabitat.slack.com/messages/C5Y62JZK8/) for further discussions.
Please extend this guide for other connection methods (photo proof needed :) ).

## Open questions

* What is written on Habitat-B disk after insertion? Online status information? Room information? Also authentication information? How can it be deleted again so as to have a "clean" B disk image again?
