var monitor = require('active-window')
    , robot = require("robotjs")
    , sleep = require('sleep');

const osModifier = 'command';

loadDisk = function(name) {
    robot.keyTap('8', osModifier);
    // wait for screen to update
    sleep.sleep(1);
    // find file (assume current dir)
    // NOTE: typeString doesn't seem to want to work in VICE
    name.split('').forEach(function(key) {
        robot.keyTap(key);
    });
    sleep.sleep(1);
    // load
    robot.keyTap('o', osModifier);
}
connectNeoHabitat = function () {
    // set to 50ms delay for safety
    robot.setKeyboardDelay(50);
    // warp mode
    robot.keyTap('w', osModifier);
    
    // load quantum link disk
    loadDisk('QuantumLink.d64');

    // c64 load
    sleep.sleep(1);

    // NOTE: typeString doesn't seem to want to work in VICE
    robot.keyTap('l');
    robot.keyTap('o');
    robot.keyTap('a');
    robot.keyTap('d');
    robot.keyToggle('shift','down');
    robot.keyTap('2');
    robot.keyTap('8');
    robot.keyTap('2');
    robot.keyToggle('shift','up');
    robot.keyTap(',');
    robot.keyTap('8');
    robot.keyTap(',');
    robot.keyTap('1');
    robot.keyTap('enter');

    //wait for modem screen
    sleep.sleep(2);

    robot.keyTap('w', osModifier);
    sleep.msleep(500);
    console.log('sending modem F1');
    robot.keyTap('f1');
    sleep.msleep(500);
    robot.keyTap('w', osModifier);

    //wait for peoplelink screen
    sleep.sleep(2);
    robot.keyTap('w', osModifier);
    sleep.msleep(500);
    console.log('sending peoplelink F1');
    robot.keyTap('f1');
    sleep.msleep(500);
    robot.keyTap('w', osModifier);

    //wait for lobby screen
    sleep.sleep(2);
    robot.keyTap('f7');

    // turn off warp mode as this can go too fast
    robot.keyTap('w', osModifier);
    //6 downs
    for(let x=0;x<6;x++) {
        robot.keyTap('down');
    }
    robot.keyTap('f1');

    // select club caribe
    robot.keyTap('f1');
    robot.keyTap('f1');

    // warp mode
    robot.keyTap('w', osModifier);
    
    // wait for side A request
    sleep.sleep(2);
    console.log('side A requested');
    loadDisk('club-caribe-a.d64');
    robot.keyTap('enter');

    //wait for side B request
    sleep.sleep(2);
    console.log('side B requested');
    loadDisk('club-caribe-b.d64');
    robot.keyTap('enter');

    console.log('DONE!');
}

viceWindowCheck = function (window) {
    try {
        if (window.app === 'x64' && window.title === 'VICE: C64 emulator') {
            console.log('Found VICE!')
            clearInterval(windowWatcher);
            connectNeoHabitat();
        }
    } catch (err) {
        console.log(err);
    }
}
waitForVice = function () {
    monitor.getActiveWindow(viceWindowCheck);
    process.stdout.write('.');
}

process.stdout.write('Set focus to VICE to continue...');

var windowWatcher = setInterval(waitForVice, 1000);