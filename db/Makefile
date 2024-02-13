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

# JSON static files to load 
TELEPORTDB = ./db-teleports.json

# Dynamic in-world objects/data
BOOKOFRECORDS = ./Text/text-bookofrecords.json

DATABASE_OBJECTS = $(TELEPORTDB)

# JSON object definitions supplied by the various components
MONGODB_OBJECTS = $(shell find . -name '*.json') $(DATABASE_OBJECTS)

DOWNTOWN_REGIONS = $(shell find new_Downtown/ -name '*.json')

# JSON objects for just the text documents
TEXT_OBJECTS = $(shell find ./Text -name '*.json') $(BOOKOFRECORDS)

# The file that actually gets produced by "make db"
DBINIT_SCRIPT = ./dbinit.sh

NEOHABITAT_MONGO_HOST ?= "127.0.0.1:27017"

define NL


endef

clean: fast

fast: nuke all

all: regions book

slow: nuke
	@make -s crawl
	@make -s book
	@make -s teleports
	
help:
	@echo ""
	@echo "Valid 'make' targets are 'teleports', 'text', 'regions', 'book', 'all', 'clean', or JSONFILENAME.o . Default is 'clean'"
	@echo "'make version' only when a major version is declared, or the beta.jlist changes for the client resources."
	@echo "Mongo output is in .errs"
	@echo ""

crawl:
	@echo "Building everything in the /db tree, one file at at time"
	@$(foreach F,$(MONGODB_OBJECTS), make -s `dirname $F!`/`basename $F .json`.o;) >> .errs 2>&1
	
book:
	@echo "Regenerating Book of Records"
	@node ../tools/generateBookOfRecords.js --book=$(BOOKOFRECORDS) --mongo=$(NEOHABITAT_MONGO_HOST)/elko
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) book_of_records >>.errs 2>&1

text: book
	@echo "Building Text documents"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) text >>.errs 2>&1

SRC=all

regions:
	@echo "Building Regions, Avatars, Objects, and Text for" ${SRC}
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) ${SRC} >>.errs 2>&1

downtown:
	@echo "Building Downtown Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) downtown_regions >>.errs 2>&1
	
woods:
	@echo "Building Woods Rd Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) woods >>.errs 2>&1	

streets:
	@echo "Building the Suburb Streets Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) streets >>.errs 2>&1	

beach:
	@echo "Building the Beach Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) beach >>.errs 2>&1	

back4t:
	@echo "Building the Back Forty Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) back4t >>.errs 2>&1	

hell:
	@echo "Building Hell Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) hell >>.errs 2>&1	

dnalsi:
	@echo "Building Dnalsi Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) dnalsi >>.errs 2>&1

users:
	@echo "Building Users Only"
	@node populateModels.js $(NEOHABITAT_MONGO_HOST) users >>.errs 2>&1

teleports:
	@echo "Building Teleport Directory"
	@rm -f $(TELEPORTDB)
	@echo '{ "ref" : "teleports", "type" : "map", "map" : {' > $(TELEPORTDB)
	@$(foreach F,$(MONGODB_OBJECTS), node dumpTeleportEntries.js < $(F) >> $(TELEPORTDB)$(NL))
	@echo ' " End Of Directory": "eod" } }' >> $(TELEPORTDB)
	@cp dbinitpre.js $(DBINIT_SCRIPT)
	@echo "eupdate(" >> $(DBINIT_SCRIPT); cat $(TELEPORTDB) >> $(DBINIT_SCRIPT); echo ")" >>$(DBINIT_SCRIPT)
	@cat dbinitpost.js >> $(DBINIT_SCRIPT)
	@cat $(DBINIT_SCRIPT) | mongo --host $(NEOHABITAT_MONGO_HOST) elko --verbose --shell mongohelper.js >> .errs 2>&1
	@rm -f $(TELEPORTDB)
		
version:
	@echo "Building Class Source for NeoHabitat.java"	
	@node convertClientDataToJava.js

%.o: %.json
	@echo "Updating" $*.json "in the database"
	@cp dbinitpre.js $(DBINIT_SCRIPT)
	@echo "eupdate(" >> $(DBINIT_SCRIPT); cat $*.json >> $(DBINIT_SCRIPT); echo ")" >>$(DBINIT_SCRIPT)
	@cat dbinitpost.js >> $(DBINIT_SCRIPT)
	@cat $(DBINIT_SCRIPT) | mongo --host $(NEOHABITAT_MONGO_HOST) elko --verbose --shell mongohelper.js >> .errs 2>&1

nuke:
	@echo "Nuking database"
	@rm -f  $(DATABASE_OBJECTS) .errs	
	@echo 'db.odb.remove({});' | mongo --host $(NEOHABITAT_MONGO_HOST) elko --verbose --shell mongohelper.js >> .errs 2>&1

deletables:
	$(foreach F,$(MONGODB_OBJECTS), if grep -q "deletable" $(F); then grep -v "deletable" <$(F) > tmp; mv tmp $(F); fi;)
