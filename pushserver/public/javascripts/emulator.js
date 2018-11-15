var emulator = new Emulator(
  document.querySelector("#emulatorCanvas"),
  null,
  new VICELoader(VICELoader.emulatorJS(EmulatorUrl),
    VICELoader.nativeResolution(0, 0),
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
        "/emulator/vice.ini")),
    VICELoader.mountFile("hotkeys.txt",
      VICELoader.fetchFile("Hotkeys",
        "/vice/hotkeys.txt")),
    VICELoader.mountFile("joymap.txt",
      VICELoader.fetchFile("Joystick Mapping",
        "/vice/joymap.txt")),
    VICELoader.fliplist([
      ["Habitat-B.d64"]
    ]),
    VICELoader.autoLoad("Habitat-Boot.d64")));

emulator.start({
  waitAfterDownloading: false
});
