# Database only portion of the Master makefile for Elko server and applications
#
# Make operations are all in reference to a configured set of applications and
# components.  These components are listed by name in the file 'components' or
# by defining COMPONENTS as an environment variable or on the make command
# line.  Also, regardless how the set of components is configured externally,
# the components will always includes the core server itself.
#
# Instructions:
# make db            - Make MongoDB setup scripts

# JSON object definitions supplied by the various components
MONGODB_OBJECTS = $(shell find . -name '*.json')

# The file that actually gets produced by "make db"
DBINIT_SCRIPT = ./dbinit.sh

# Make the database setup stuff
db:
	rm $(DBINIT_SCRIPT)
	echo '#!/bin/bash' > $(DBINIT_SCRIPT)
	echo 'mongo elko --verbose --shell mongohelper.js <<ENDINITS' >> $(DBINIT_SCRIPT)
	cat dbinitpre.js >> $(DBINIT_SCRIPT)
	$(foreach F,$(MONGODB_OBJECTS),echo "eupdate("`sed -e 's/\\\/\\\\\\\\/' -e 's/\\$$/\\\\$$/' < $(F)`")" >> $(DBINIT_SCRIPT);)
	cat dbinitpost.js >> $(DBINIT_SCRIPT)
	echo 'ENDINITS' >> $(DBINIT_SCRIPT)
	chmod +x $(DBINIT_SCRIPT)
	$(DBINIT_SCRIPT)



