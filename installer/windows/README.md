# neohabitat-installer
This is an installer for NeoHabitat created using [Inno Setup](https://jrsoftware.org/isinfo.php) v6.0.3 - [Source code](https://github.com/jrsoftware/issrc/releases/tag/is-6_0_3).

The files used to create this installer were taken directly from the [NeoHabitat.zip](https://github.com/frandallfarmer/neohabitat-doc/blob/master/installers/Neohabitat.zip)  file currently available on the [neohabitat-doc](https://github.com/frandallfarmer/neohabitat-doc) repository.

To build the distribution package:

* Ensure you've grabbed the latest version of Inno Setup as mentioned previously.

* Download the NeoHabitat zip file mentioned previously.

* Place the files from the zip wherever you want but take note of their location.

* Open the NeoHabitatInstaller.iss script file in Inno Setup.

* Edit the file paths of the NeoHabitat source files to match the location you saved them to.

* Edit the file paths to make sure you locate the following files that are in the same folder as this readme.

 - **LICENSE**
 - **COPYING.txt**
 - **intro.txt**

* Edit the file paths to choose a place to output the compiled executable.

* Click Build > Compile.