# Neohabitat Client VICE Login Driver

This directory contains scripts to automate the login of a pre-configured Neohabitat client.

## Usage

### **All Platforms**

1. Configure VICE RS232 settings per the Neohabitat [Getting Started](https://github.com/frandallfarmer/neohabitat/blob/master/README.md) documentation.
2. Run though the entire client process at least once. The scripts assume that
your `QuantumLink.d64` disk has been configured to your own avatar. The scripts do **not** handle the prompts for your name, city, state, etc.
3. Ensure that all three disk images are in the same directory and that VICE
is using that directory as the current default. In other words, make sure you
attach a disk from the directory before running the scripts.
4. All done? Skip down to your platform of choice.

### **Windows**

Tested.

1. Install [AutoHotkey](https://autohotkey.com/) if you do not have it.
2. Run AutoHotkey with the script in `AutoHotkey.ahk` by either:
   * incorporating the script in your own AutoHotkey script library.
   * placing the script in the same directory as `AutoHotkey.exe` and running
the executable.
   * drag-n-dropping the script to the `AutoHotkey.exe` executable.
3. Have VICE configured and running per the All Platforms section.
4. With VICE in focus, press Win-Shift-F12.
5. Watch the magic and hope nothing goes wrong!

### **OS X**

Tested.

1. Requires [Node](https://nodejs.org/), `node-gyp`, Python 2.7 to be installed.
2. Open a terminal session.
3. `cd` to the directory that has `app.js`.
2. Run `npm install` to pull down and build dependencies.
3. Go to `System Preferences`/`Security & Privacy`/`Privacy` tab/`Accessibility`.
4. Make sure `Terminal.app` is in the list of apps allowed to control your computer.
5. Start VICE (make sure you've followed the steps in the All Platforms section!)
6. In the terminal, type `node app.js`.
7. Click on VICE to give it focus.
5. Watch the magic and hope nothing goes wrong!

### **Linux**

Untested.

**Should be** very similar to the OS X instructions. You may need to change the
`osModifier` const.

## Known issues

* **Need to test Linux.**
* `robotjs` is cross-platform, however it has trouble sending keys to VICE. This is
why Windows makes use of AutoHotkey. I'd love to consolidate to a single script if
possible. I tried all methods to get it working in Windows but ran into multiple bugs:
  * Even though `robotjs` looks like it's using the old-school `Send` method instead
of `SendInput` - `Send` works with AutoHotkey in Win but VICE still misintereprets it
when coming from `robotjs`.
  * There are a few issues in `robotjs` that suggest key modifiers are not being
released. This may be a root cause.
  * `active-window` has an [outstanding issue](https://github.com/octalmage/active-window/pull/14)
on Windows.
* You may (will?) have to tweak the sleep timings.
* The scripts assume the "happy path". If anything goes wrong (common: modem connect
fail, PeopleLink not recognizing the initial F1, slower-than-expected load times) the
script will continue to run and be out of "sync". Both libraries have varying degrees
of image capture/recognition. There may be some opportunities there. Other thoughts
are to somehow pull state from VICE (not sure if possible) or offer a debug communication
path from the server to the client automation script (again, not sure if this makes sense.)