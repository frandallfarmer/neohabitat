# Setting up a real C64 to play Neohabitat
Guide written June 7th 2017 by Goethe ([Github](https://github.com/napi-goethe) / [Website](http://www.carpeludum.com) / [Twitter @Goe_The](https://twitter.com/Goe_The)),
with many thanks to the Neohabitat Slack #troubleshooting channel team: @stu, @glake1 and of course @randy

## What hardware do you need

* a C64 (any model)
* at least one floppy drive - I used a 1541-II.
  * step 2.3 will be much faster if you have two floppy drives, but one is ok too
* two **working** 5,25" floppy disks
  * disks die over time. Please make sure you have two still good ones. I wasted one hour of Neohabitat launch night testing with a weak/defective disk.
* special hardware to transfer D64 disk images from PC to real C64 floppy disks
  * for this guide, I used an RR-Net MK3 expansion port ethernet adapter [available here from Individual Computers](https://icomp.de/shop-icomp/de/shop/product/rr-net-mk3.html)
  * other possibilities exist, but have not been tested yet - the C64 community is welcome to test and add experiences, for example:
    * XM/XA/XAP transfer cables
    * 1541 Ultimate
    * ... (to be extended by the community)
* special hardware for connecting the C64 to the Internet via the serial port method (user port)
  * for this guide, I used the "Australian" userport WiFi modem [available here from Melbourne Console Reproductions](http://melbourneconsolerepros.com/product_info.php?products_id=125)
  * other possibilities exist, but have not been tested yet - the C64 community is welcome to test and add experiences, for example:
    * other C64 WiFi userport modems such as the U.S. one (cbmstuff.com)
    * RR-Net MK3
    * 1541 Ultimate
    * ... (to be extended by the community)

## Required D64 disk images

The archive `Neohabitat-RealC64SuccessPackage.zip` contains the exact files with which I was successful in connecting to Neohabitat:
* `Habitat-A.d64`
* `Habitat-B.d64`
* `hb-zipped.d64`
* `QLink-Habitat.d64`

Other disk images exist in various places in the internet.
Using binary compare, the "other" disk images I found all have slight differences to the ones in the above package.
Until the similarities or differences between them have been identified, I recommend to go with the disk set attached to this readme, because it reproducibly leads to a connection success.

IMPORTANT: After first use of the disks on the real C64, stuff is written to both the QLink-Habitat "boot" disk, and Habitat-B disk. I suppose the authentication information is saved on both disks. It might also be possible that some online state information is saved on disk B. This has to be investigated. In any case it leads to the situation that you should not create new disk images from the real disks, otherwise your authentication and/or online status information may be propagated unintentionally.

## Guide Step 1 - Transfer QLink-Habitat and Habitat-A to real C64 floppy disks

#### using RR-Net MK3

Unfortunately, this is a hen-and-egg problem. You need **someone** to get you the C64 program `WARPCOPY06` from following step 1 to a real C64 disk, so you can continue with steps 2 and 3... Have you visited a retro computer party lately? :)

1. Get and start warpcopy06 [from CSDB here](http://csdb.dk/release/?id=147362)
2. Using warpcopy06, write QLink-Habitat.d64 to side A of your first real C64 disk
3. Using warpcopy06, write Habitat-A.d64 to side A of your second real C64 disk

#### using any other method

(to be written by the community, when successfully tested)

## Guide Step 2 - Transfer the Habitat-B to real C64 floppy disks

This is where it gets weird (see end of this guide - open questions).

### Step 2.1 - Prepare C64-zipped image of Habitat-B.D64

This is just for purpose of documentation of how I did this. You can skip doing this step and directly continue with step 2.2, because the resulting disk image `hb-zipped.d64` is already contained in the archive `Neohabitat-RealC64SuccessPackage.zip`.

1. Get Zip Collection V2.0 [from CSDB here](http://csdb.dk/release/?id=57186)
2. Fire up Vice C64 emulator
3. attach Zip Collection to drive 8
4. attach `Habitat-B.d64` to drive 9
5. attach a newly created empty disk `hb-zipped.d64` to drive 10
6. load Zip Collection application `ZIP-COLL.V2 /AFL` from drive 8
7. choose option 1 "Diskpacker" to create a "C64-zipped" version of Habitat-B disk named `hbz` from source drive 9 to target drive 10
8. copy Zip Collection application from drive 8 to drive 10, so that the disk contains both the C64-compressed disk image of Habitat-B and the uncompression tool to use on the real C64
9. close Vice C64 emulator. You now have a disk image `hb-zipped.d64` to transfer to the real C64

### Step 2.2 - Transfer image to real C64 floppy disk

Follow step 1 to transfer `hb-zipped.d64` to side B of your first real C64 disk.

### Step 2.3 - C64-unzip prepared image 

1. On the real C64, load up side B of your first real C64 disk and load the zip application tool `ZIP-COLL.V2 /AFL`
2. choose option 2 "Diskunpacker"
3. enter filename `hbz`, choose source drive and target drive accordingly
4. use the side B of your second real floppy as target disk
3. if source and target drive are the same (if you have only one floppy drive), you will now do a lot of disk swapping

Now finally, you have full working real C64 disk set for connecting to Neohabitat
* Disk 1
  * Side A: QLink-Habitat boot disk
  * Side B: (can be formatted again, no use anymore)
* Disk 2
  * Side A: Habitat Disk A
  * Side B: Habitat Disk B

## Guide Step 3 - Prepare the WiFi Modem for Neohabitat

#### using Australian WiFi modem from Melbourne Console Reproductions

This section assumes you are familiar with the general setup of the modem according to it's user manual,
e.g. using Striketerm to issue modem commands.

1. Configure your WiFi modem to connect to your WiFi network (probably you already did that anyway)
2. For use with Neohabitat, the modem needs to be set to 1200 baud
  * `at$sb=1200`
3. If you are lazy, you can set the Neohabitat Q-Link server to a speed dial slot, e.g. 0:
  * `at&z0=52.87.109.252:5190`
4. Don't forget to save the defaults
  * `at&w`

#### using any other method

(to be written by the community, when successfully tested)

## Guide Step 4 - Connect to Q-Link

Starting from here, we can begin following [@randy's "secret" guide for the Q-Link boot located here, at Step 3](https://github.com/frandallfarmer/neohabitat/blob/9e998ac6779459c392e5e516d05981066a1012be/README.md#step-3---connect-to-quantumlink-reloaded)

#### using Australian WiFi modem from Melbourne Console Reproductions

When you reach the following step
* After finishing this process, select SIGN ON TO Q-LINK. You'll be brought to a green-framed screen which states `Type commands to the modem, then press F1 when connection is made.`

Here, you enter the commands required to connect the "Australian" WiFi modem to the Neohabitat Q-Link Login server:
* `ati`
  * (modem responds with hello, and connects to your WiFi network)
* `atc1` (optional)
  * (modem connects to your WiFi network, if first connection attempt has failed, which happens quite often to me)
* `atds0`
  * (modem connects to speed dial 0, i.e. the Neohabitat Q-Link login server)

Then you should see `CONNECT 1200` - then press `F1`
If you don't see it, there may be a problem with your internet connection - or with the Neohabitat server (it may be down from time to time).

#### using any other method

(to be written by the community, when successfully tested)

## Guide Step 4 - Login to Q-Link and Start Neohabitat

1. Continue with [@randy's "secret" guide for the Q-Link boot located here, in step 3, with the instructions  ](https://github.com/frandallfarmer/neohabitat/blob/9e998ac6779459c392e5e516d05981066a1012be/README.md#step-3---connect-to-quantumlink-reloaded)
2. When prompted, insert Habitat Disk A (your second real C64 disk, side A)
3. When prompted, insert Habitat Disk B (your second real C64 disk, side B)

# Enjoy Neohabitat on your real C64!

And join the slack for further discussions.
Please extend this guide for other connection methods (photo proof needed :) ).

## Why is this so complicated? / Open questions

The B disk of Habitat is "special". Regular transfer of the D64 image (using the same method as in step 1 or 2.1 for the QLink-Boot and A disks) **does not work** for currently unknown reasons.
Is that a problem of warpcopy06? Would a transfer of disk B with XM/XA/XAP1541 cables work? What other methods are there to write a working B disk for a real C64?

The other open questions are
* What is written on QLink-Habitat "boot" disk? Assumed, it is the authentication information (username only? secret password?). How can it be deleted again so that a new registration is possible, so as to have a "clean" boot disk again?
* What is written on Habitat-B disk after inseration? Online status information? Room information? Also authentication information? How can it be deleted again so as to have a "clean" B disk image again?
