// Vice's Joystick Device 4 == Joystick, whereas Joystick Device 2 == Keyset 1
var JoyDevice1 = supportsGamepads() ? 4 : 2;

var emulatorCanvas = document.getElementById("emulatorCanvas");

var emulator = new Emulator(
  emulatorCanvas,
  null,
  new VICELoader(
    VICELoader.emulatorJS(EmulatorUrl),
    VICELoader.nativeResolution(160, 200),
    VICELoader.extraArgs([
      "-ntsc",
      "-soundfragsize", "4",
      "-soundrate", "48000",
      "-soundsync", "2",
      "-soundbufsize", "150",
      "-residsamp", "0",
      "-config", "/emulator/vice.ini"
    ]),
    VICELoader.mountFile("Habitat-Boot.d64",
      VICELoader.fetchFile("Neohabitat Boot",
        "/disks/Habitat-Boot.d64")),
    VICELoader.mountFile("Habitat-B.d64",
      VICELoader.fetchFile("Neohabitat Imagery",
        "/disks/Habitat-B.d64")),
    VICELoader.mountFile("vice.ini",
      VICELoader.fetchFile("Configuration",
        "/emulator/vice.ini?jd1=" + JoyDevice1)),
    VICELoader.mountFile("hotkeys.txt",
      VICELoader.fetchFile("Hotkeys",
        "/vice/hotkeys.txt")),
    VICELoader.mountFile("joymap.txt",
      VICELoader.fetchFile("Joystick Mapping",
        "/vice/joymap.txt")),
    VICELoader.fliplist([
      ["Habitat-B.d64"]
    ]),
    VICELoader.autoLoad("Habitat-Boot.d64")
  )
);

function resumeAudio(e) {
  if (typeof SDL == 'undefined'
    || typeof SDL.audioContext == 'undefined')
    return;
  if (SDL.audioContext.state == 'suspended') {
    SDL.audioContext.resume();
  }
  if (SDL.audioContext.state == 'running') {
    document.getElementById('emulatorCanvas').removeEventListener('click', resumeAudio);
    document.removeEventListener('keydown', resumeAudio);
  }
}
emulatorCanvas.addEventListener('click', resumeAudio);
document.addEventListener('keydown', resumeAudio);

function startEmulator() {
  $('#emulatorPanel').removeClass('d-none');
  $('#emulatorStartPanel').addClass('d-none');
  emulator.start({
    waitAfterDownloading: false
  });
  resumeAudio();
}

document.getElementById("emulatorStartPanel").addEventListener('click', startEmulator);
