
/** writeHabitatUser.js - Add/update a user in the Neo Habtiat Elko Mongo Database and add them to the database file store. */

const MongoClient	= require('mongodb').MongoClient;
const Assert 		= require('assert');
const ObjectId 		= require('mongodb').ObjectID;
const File		    = require('fs');

/** Object holding command line args - parsed by yargs library: npm install yargs */	
const Argv 		 = require('yargs')
.usage('\nAdds a user to the NeoHabitat mongodb [option: Saves in .json file]\n\nUsage: $0 --name=USERNAME')
.example('$0 --name=ShortName', 'Create a new NeoHabitat Avatar object, ref: user-shortname  name:ShortName')
.example('$0 --name=ExistingName --god --force', 'Set the god bit for an existing avatar-user')
.option('name',		 { alias: 'n',								describe: 'Mixed case user name with NO whitespace'})
.option('force',	 { alias: 'f', default:false,				describe: 'Force overwrite of any existing user-avatar'})
.option('god',		 { alias: 'g', default:false,				describe: 'Set GOD_BIT'})
.option('body',		 { alise: 'b', default:"male",				describe: 'Avatar body type'})
.option('help',		 { alias: 'h', 						     	describe: 'Get this usage/help information'})
.option('savedir',	 { alias: 's',								describe: 'Save as user-NAME.json in this directory. Unspecified = no file.'})
.demandOption('name')
.help('help')
.argv;

function rnd(max) {
	return Math.floor(Math.random()*max)
}

const NewUser = {
		"type": "user",
		"ref": "user-" + Argv.name.toLowerCase(),
		"name": Argv.name,
		"mods": [
			{
				"type": "Avatar",
				"x": 10,
				"y": 128 + rnd(32),
				"bodyType": Argv.body,
				"bankBalance": 5000,
				"custom": [rnd(15) + rnd(15)*16, rnd(15) + rnd(15)*16],
				"nitty_bits": Argv.god ? 8 : 0
			}
			]
};

if (Argv.savedir) {
	var path = Argv.savedir + "/" + NewUser.ref + ".json";
	if (!File.existsSync(path) || Argv.force) {
		File.writeFile(path, JSON.stringify(NewUser, null, 2));
	}
}

function testUser(db, callback) {
	db.collection('odb').findOne({ref: NewUser.ref}, callback);
}

function insertUser(db, callback) {
	db.collection('odb').updateOne(
			{ref: NewUser.ref},
			NewUser,
			{upsert: true},
			function(err, result) {
				Assert.equal(err, null);
				callback();
			});
}

var url = 'mongodb://localhost:27017/elko';

MongoClient.connect(url, function(err, db) {
	Assert.equal(null, err);
	testUser(db, function(err, result) {
		if (result === null || Argv.force) {
			insertUser(db, function() {
				db.close();
			});
		} else {
			db.close();
		}
	});
});

