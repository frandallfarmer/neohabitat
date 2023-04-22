
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
	.option('name',		 { alias: 'n',								describe: 'user name - mixed-case with NO whitespace'})
	.option('force',	 { alias: 'f', default:false,				describe: 'force overwrite of any existing user-avatar'})
	.option('god',		 { alias: 'g', default:false,				describe: 'set GOD_BIT'})
	.option('body',		 { alise: 'b', default:"male",				describe: 'avatar body type'})
	.option('url',		 { alias: 'u', default:'//neohabitatmongo/elko',	describe: 'mongodb server url.'})
	.option('savedir',	 { alias: 's',								describe: 'directory for user-NAME.json. Unspecified == no file'})
	.demandOption('name')
	.option('help',		 { alias: 'h', 						     	describe: 'Get this usage/help information'})
	.help('help')
	.argv;

function rnd(max) {
	return Math.floor(Math.random()*max)
}

const NewUser = {
		"type": "user",
		"ref": "user-" + Argv.name.toLowerCase().replace(/ /g,"_"),
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
			{ $set: NewUser},
			{upsert: true},
			function(err, result) {
				Assert.equal(err, null);
				callback();
			});
}

var url = 'mongodb:' + Argv.url;

const dbName = 'elko';


MongoClient.connect(url, function(err, client) {
	Assert.equal(null, err);
	let db = client.db(dbName);
	testUser(db, function(err, result) {
		if (result === null || Argv.force) {
			insertUser(db, function() {
				client.close();
			});
		} else {
			client.close();
		}
	});
});

