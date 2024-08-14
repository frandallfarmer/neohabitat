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

GIT_BASE_DIR = ..

# JSON static files to load 
TELEPORTDB = $(GIT_BASE_DIR)/db/db-teleports.json

# Dynamic in-world objects/data
BOOKOFRECORDS = $(GIT_BASE_DIR)/db/Text/text-bookofrecords.json

DATABASE_OBJECTS = $(TELEPORTDB)


# JSON object definitions supplied by the various components
MONGODB_OBJECTS = $(shell find $(GIT_BASE_DIR)/db -name '*.json' -not -name 'package.json' -not -name 'package-lock.json') $(DATABASE_OBJECTS)

DOWNTOWN_REGIONS = $(shell find $(GIT_BASE_DIR)/db/new_Downtown/ -name '*.json' -not -name 'package.json' -not -name 'package-lock.json')

# JSON objects for just the text documents
TEXT_OBJECTS = $(shell find $(GIT_BASE_DIR)/Text -name '*.json') $(BOOKOFRECORDS)

# The file that actually gets produced by "make db"
DBINIT_SCRIPT = $(GIT_BASE_DIR)/db/dbinit.sh

NEOHABITAT_MONGO_HOST ?= "127.0.0.1:27017"

define NL


endef

clean: fast

fast: nuke all

all: regions
	
book:
	@echo "Regenerating Book of Records"
	@npm run generateBookOfRecords -- --book=$(BOOKOFRECORDS) --mongo=$(NEOHABITAT_MONGO_HOST)/elko
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) book_of_records

text: book
	@echo "Building Text documents"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) text

regions:
	@echo "Building Regions, Avatars, Objects, and Text for all"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) all

downtown:
	@echo "Building Downtown Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) downtown_regions
	
woods:
	@echo "Building Woods Rd Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) woods

streets:
	@echo "Building the Suburb Streets Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) streets

beach:
	@echo "Building the Beach Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) beach

back4t:
	@echo "Building the Back Forty Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) back4t

hell:
	@echo "Building Hell Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) hell

dnalsi:
	@echo "Building Dnalsi Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) dnalsi

users:
	@echo "Building Users Only"
	@npm run populateModels -- $(NEOHABITAT_MONGO_HOST) users
		
version:
	@echo "Building Class Source for NeoHabitat.java"	
	@npm run convertClientDataToJava

nuke:
	@echo "Nuking database"
	@npm run dbUtils -- $(NEOHABITAT_MONGO_HOST) nuke
