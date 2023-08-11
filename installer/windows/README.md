# neohabitat-installer
This is an installer for [NeoHabitat](http://neohabitat.org) created using [Inno Setup](https://jrsoftware.org/isinfo.php) v6.2.1 - [Source code](https://github.com/jrsoftware/issrc/releases/tag/is-6_2_1).

Only the base files for the installer are stored here in the neohabitat repository, the actual binaries for everything are stored at the [neohabitat-installer](https://github.com/StuBlad/neohabitat-installer) repository. The reason for this is to avoid clogging up the main NeoHabitat repository.

The installer bundles togther VICE 3.7, preconfigured settings to connect to the Habitat server hosted by [The MADE](https://themade.org) and the Habitat disk images modified for the NeoHabitat project that bypass the original Quantum Link procedure.

To build the distribution package:

* Ensure you've grabbed either the version of Inno Setup mentioned previously or a more recent build.

* Visit the [GitHub repository](https://github.com/StuBlad/neohabitat-installer/tree/master/Neohabitat) that hosts all of the binary data that makes up the distribution package and download it. 

* Place the content of the Neohabitat folder files from the GitHub repo into the same folder this README file is in.

* Open the NeoHabitatInstaller.iss script file in Inno Setup.

* Edit the file paths of the NeoHabitat source files to match the location you saved them to if necessary (you shouldn't need to if you placed them in the same directory as this README).

* Click Build > Compile.

* The compiled binary should be located in the Compiled folder in the directory this README is in.