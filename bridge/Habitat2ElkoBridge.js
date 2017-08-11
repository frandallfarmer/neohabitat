/**
 * 1986 Habitat and 2016 Elko don't speak the same protocol.
 * 
 * Until we can extend Elko appropriately, we'll use this proxy to translate between
 * the protocols.
 * 
 * This bridge does two different things:
 * 1) Translates Binary Habitat Protocol to Elko JSON packets
 * 2) Deals with various differences in client-server handshaking models,
 *    such as Habitat server managed region changes vs. client requested context changes.
 * 
 */

/* jslint bitwise: true */
/* jshint esversion: 6 */

const Net		 	= require('net');
const File		 	= require('fs');
const Trace		 	= require('winston');
const MongoClient	= require('mongodb').MongoClient;
const Assert 		= require('assert');
const ObjectId 		= require('mongodb').ObjectID;

const DefDefs	= { 
		context:	'context-Downtown_5f',
		listen:		'127.0.0.1:1337',
		elko:		'127.0.0.1:9000',
		mongo:		'127.0.0.1:27017/elko',
		rate:		1200,
		realm:		'Popustop',
		trace:		'info'};
var	 Defaults	= DefDefs;

try {
	var userDefs = JSON.parse(File.readFileSync("defaults.elko"));
	Defaults = {
			context:	userDefs.context	|| DefDefs.context,
			listen:		userDefs.listen	 	|| DefDefs.listen,
			elko:		userDefs.elko		|| DefDefs.elko,
			mongo:		userDefs.mongo  	|| DefDefs.mongo,
			rate:		userDefs.rate		|| DefDefs.rate,
			realm:		userDefs.realm		|| DefDefs.realm,
			trace:		userDefs.trace		|| DefDefs.trace};
} catch (e) {
	console.log("Missing/invalid defaults.elko configuration file. Proceeding with factory defaults.");
}

const Argv 		 = require('yargs')
.usage('Usage: $0 [options]')
.help('help')
.option('help',		{ alias: '?', 						     describe: 'Get this usage/help information'})
.option('trace', 	{ alias: 't', default: Defaults.trace, 	 describe: 'Trace level name. (see: npm winston)'})
.option('context',  { alias: 'c', default: Defaults.context, describe: 'Parameter for entercontext for unknown users'})
.option('listen',   { alias: 'l', default: Defaults.listen,  describe: 'Host:Port to listen for client connections'})
.option('elko',		{ alias: 'e', default: Defaults.elko,    describe: 'Host:Port of the Habitat Elko Server'})
.option('mongo',	{ alias: 'm', default: Defaults.mongo,   describe: 'Mongodb server URL'})
.option('rate',		{ alias: 'r', default: Defaults.rate,	 describe: 'Data rate in bits-per-second for transmitting to c64 clients'})
.option('realm',	{ alias: 'a', default: Defaults.realm,	 describe: 'Realm within which to assign turfs'})
.argv;

Trace.level 	 = Argv.trace;

const HCode		 = require('./hcode');
const Millis	 = 1000;
const UFILENAME	= "./usersDB.json";

var	  Users = {};
try {
	Users	= JSON.parse(File.readFileSync(UFILENAME));
} catch (e) { /* do nothing */ }

var listenaddr	 = Argv.listen.split(":");
var elkoaddr	 = Argv.elko.split(":");
var ListenHost	 = listenaddr[0];
var ListenPort	 = listenaddr.length > 1 ? parseInt(listenaddr[1]) : 1337;
var ElkoHost	 = elkoaddr[0];
var ElkoPort	 = elkoaddr.length > 1   ? parseInt(elkoaddr[1])   : 9000;

var SessionCount = 0;
var MongoDB = {};

const UNASSIGNED_NOID = 256;

function rnd(max) {
	return Math.floor(Math.random() * max)
}

function findOne(db, query, callback) {
	db.collection('odb').findOne(query, callback);
}

function userHasTurf(user) {
	return (
		user.mods[0].turf !== undefined && 
		user.mods[0].turf != "" &&
		user.mods[0].turf != "context-test"
	);
}

function ensureTurfAssigned(db, userRef, callback) {
	db.collection('odb').findOne({
		"ref": userRef
	}, function(err, user) {
		Assert.equal(err, null);
		Assert.notEqual(user, null);

		// Don't assign a turf Region -to a User if one is already assigned.
		if (userHasTurf(user)) {
			Trace.debug("User %s already has a turf Region assigned: %s",
				userRef, user.mods[0].turf);
			callback();
			return;
		}

		// Searches for an available turf Region and assigns it to the User if found.
		db.collection('odb').findOne({
			"mods.0.type": "Region",
			"mods.0.realm": Argv.realm,
			"mods.0.is_turf": true,
			$or: [
				{ "mods.0.resident": { $exists: false } },
				{ "mods.0.resident": "" }
			]
		}, function(err, region) {
			Assert.equal(err, null);
			if (region === null) {
				Trace.error("Unable to find an available turf Region for User: %j", user);
				callback();
				return;
			}
			Trace.debug("Assigning turf Region %s to Avatar %s", region.ref, user.ref);

			// Assigns the available region as the given user's turf.
			user.mods[0]['turf'] = region.ref;
			region.mods[0]['resident'] = user.ref;

			// Updates the User's Elko document with the turf assignment.
			db.collection('odb').updateOne(
				{ref: region.ref},
				region,
				{upsert: true},
				function(err, result) {
					Assert.equal(err, null);
					db.collection('odb').updateOne(
						{ref: user.ref},
						user,
						{upsert: true},
						function(err, result) {
							Assert.equal(err, null);
							callback();
						});
				});
		});
	});
}

function setFirstConnection(db, userRef) {
	db.collection('odb').findOne({
		"ref": userRef
	}, function(err, user) {
		user.mods[0].firstConnection = true;
//		user.mods[0].amAGhost = true;				// TODO Once ghosts are working well, return the ARRIVE AS GHOST feature! FRF
		db.collection('odb').updateOne(
				{ref: user.ref},
				user,
				{upsert: true},
				function(err, result) {
					Assert.equal(err, null);
					if (result === null)
						Trace.debug("Unable to setFirstConnection  for " + userRef);
				});
	});
}

function insertUser(db, user, callback) {
	db.collection('odb').updateOne(
			{ref: user.ref},
			user,
			{upsert: true},
			function(err, result) {
				Assert.equal(err, null);
				callback();
			});
}

function addDefaultHead(db, userRef, fullName) {
	headRef = "item-head" + Math.random();
	db.collection('odb').insertOne({
		"ref": headRef,
		"type": "item",
		"name": "Default head for " + fullName,
		"in":userRef,
		"mods": [
			{
				"type": "Head",
				"y": 6,
				"style": rnd(220),
				"orientation": rnd(3) * 8
			}
			]
	}, function(err, result) {
		Assert.equal(err, null);
		if (result === null) {
			Trace.debug("Unable to add " + headRef + " for " + userRef);
		}
	}
	)
}

function addPaperPrime(db, userRef, fullName) {
	paperRef = "item-paper" + Math.random();
	db.collection('odb').insertOne({
		"ref": paperRef,
		"type": "item",
		"name": "Paper for " + fullName,
		"in":userRef,
		"mods": [
			{
				"type": "Paper",
				"y": 4,
				"orientation": 16
			}
			]
	}, function(err, result) {
		Assert.equal(err, null);
		if (result === null) {
			Trace.debug("Unable to add " + paperRef + " for " + userRef);
		}
	}
	)
}

function addDefaultTokens(db, userRef, fullName) {
	tokenRef = "item-tokens" + Math.random();
	db.collection('odb').insertOne({
		"ref": tokenRef,
		"type": "item",
		"name": "Money for " + fullName,
		"in":userRef,
		"mods": [
			{
				"type": "Tokens",
				"y": 0,
				"denom_lo": 0,
				"denom_hi": 4
			}
			]
	}, function(err, result) {
		Assert.equal(err, null);
		if (result === null) {
			Trace.debug("Unable to add " + tokenRef + " for " + userRef);
		}
	}
	)
}


function readUserAndClose(db, userRef, client) {
	findOne(db, {ref: userRef}, function(err, user) {
			client.user = user;
			db.close();
	});
}

function confirmOrCreateUser(fullName, client) {
	var userRef = client.userRef;
	if (client.firstConnection) {
		userRef = "user-" + fullName.toLowerCase().replace(/ /g,"_");
		MongoClient.connect("mongodb://" + Argv.mongo, function(err, db) {
			Assert.equal(null, err);
			findOne(db, {ref: userRef}, function(err, result) {
				if (result === null || Argv.force) {
					var newUser = {
							"type": "user",
							"ref": userRef,
							"name": fullName,
							"mods": [
								{
									"type": "Avatar",
									"firstConnection": true,
									"amAGhost": false, // TODO return to true after bugs with ghosts are fixed. FRF
									"x": 10,
									"y": 128 + rnd(32),
									"bodyType": "male",
									"bankBalance": 50000,
									"custom": [rnd(15) + rnd(15)*16, rnd(15) + rnd(15)*16],
									"nitty_bits": 0
								}
								]
					};
					insertUser(db, newUser, function() {
						addDefaultHead(db, userRef, fullName);
						addPaperPrime(db, userRef, fullName);
						addDefaultTokens(db, userRef, fullName);
						ensureTurfAssigned(db, userRef, function() {
							readUserAndClose(db, userRef, client);
						});
					});
				} else {
					setFirstConnection(db, userRef);
					ensureTurfAssigned(db, userRef, function() {
						readUserAndClose(db, userRef, client);
					});
				}
			});
		});
	}
	return userRef;
}

String.prototype.getBytes = function () {
	var bytes = [];
	for (var i = 0; i < this.length; ++i) {
		bytes.push(this.charCodeAt(i));
	}
	return bytes;
};

/**
 * These are byte packets, and you needed to make sure to escape your terminator/unsendables.
 *  
 * @param b {buffer} The characters in the message to be escaped
 * @returns encoded char array
 * 
 */
function escape(b, zero) {
	zero = zero || false;
	var r = [];
	for (var i = 0; i < b.length; i++) {
		var c = b[i];
		if (c === HCode.END_OF_MESSAGE || c === HCode.ESCAPE_CHAR || (zero && c === 0)) {
			r[r.length] = HCode.ESCAPE_CHAR;
			c ^= HCode.ESCAPE_XOR;
		}
		r[r.length] = c;
	}
	return r;
}

/**
 * These were byte packets, and you needed to make sure to escape your terminator/unsendables.
 *  
 * @param b {buffer} The characters in the message to be escaped
 * @returns decoded char array
 */
function descape(b, skip) {
	var r = [];
	var i = skip || 0;
	while (i < b.length) {
		var c = b[i];
		if (c === HCode.ESCAPE_CHAR) {
			i++;
			c = b[i] ^ HCode.ESCAPE_XOR;
		}
		r[r.length] = c;
		i++;
	}
	return r;
}

var PACKETOVERHEAD = 20;	// Adjustment for Qlink Protocol and Framing.

function timeToXmit(bytes) {
	return (bytes + PACKETOVERHEAD) * 8 / Argv.rate * Millis;
}

/*
 * Elko uses a fresh connection for every context/region change.
 */
function createServerConnection(port, host, client, immediate, context) {
	var server = Net.connect({port: port, host:host}, function() {
		Trace.debug( "Connecting: " + 
				client.address().address +':'+ client.address().port +
				" <-> " +
				server.address().address + ':'+ server.address().port);
		if (immediate) {
			enterContext(client, server, context);
		}

		server.on('data', function(data) {
			var reset = false;
			try {
				reset = processIncomingElkoBlob(client, server, data);				
			} catch(err) {
				Trace.error("\n\n\nServer input processing error captured:\n" +
						err.message + "\n" +
						err.stack   + "\n" +
				"...resuming...\n");
			}
			if (reset) {				// This connection has been replaced due to context change.
				Trace.debug("Destroying connection: " + server.address().address + ':' + server.address().port);

				// Make sure any outgoing messages have been sent...
				var now  = new Date().getTime();
				var when = Math.ceil(client.timeLastSent + timeToXmit(client.lastSentLen));
				if (when <= now) {
					server.destroy();
				} else {
					var delay = Math.ceil(Math.max(0, (when - now)));
					setTimeout(function () { server.destroy(); }, delay);
				}		
			}
		});

		// If we see a socket exception, logs it instead of throwing it.
		server.on('error', function(err) {
			Trace.warn("Unable to connect to NeoHabitat Server, terminating client connection.");
			if (client) {
				if (client.userName) {
					Users[client.userName].online = false;
				}
				client.end(); 
			}
		});

		// What if the Elko server breaks the connection? For now we tear the bridge down also.
		// If we ever bring up a "director" based service, this will need to change on context changes.

		server.on('end', function() {
			Trace.debug('Elko port disconnected...');
			if (client) {
				Trace.debug("{Bridge being shutdown...}");
				if (client.userName) {
					Users[client.userName].online = false;
				}
				client.end();
			}
		});

		client.removeAllListeners('data').on('data', function(data) {
			try {
				frameClientStream(client, server, data);				
			} catch(err) {
				Trace.error("\n\n\nClient input processing error captured:\n" + 
						JSON.stringify(err,null,2) + "\n" +
						err.stack + "\n...resuming...\n");
			}
		});

		client.removeAllListeners('close').on('close', function(data) {
			Trace.debug("Habitat client disconnected.");
			if (server) { 
				server.end(); 
			}
		});
	});
}

function isString(data) {
	return (typeof data === 'string' || data instanceof String);
}

function guardedWrite(connection, msg) {
	try {
		connection.rawWrite(msg);
	} catch (e) {
		Trace.warn(e.toString());
	}
}

function futureSend(connection, data) {
	var now  = new Date().getTime();
	var when = Math.ceil(connection.timeLastSent + timeToXmit(connection.lastSentLen));

	connection.lastSentLen = data.length;
	
	if (when <= now) {
		connection.write(data);
		connection.timeLastSent = now;
	} else {
		var delay = Math.ceil(Math.max(0, (when - now)));
		var msg = (isString(data)) ? data : Buffer.from(escape(data));
		setTimeout(function () { guardedWrite(connection, msg); }, delay);
		connection.timeLastSent = when;
	}
}

function toHabitat(connection, data, split) {
	split = split || false;
	if (connection.json) {
		connection.write(JSON.stringify(data));
		connection.write(connection.frame);
	} else {
		var header = data.slice(0,4);
		if (split) {
			var payload = data.slice(4);
			for (var start = 0; start < payload.length; start += HCode.MAX_PACKET_SIZE) {
				var bytes = payload.slice(start);
				var size = Math.min(HCode.MAX_PACKET_SIZE, bytes.length);
				var seqbyte = header[1] & HCode.SPLIT_MASK;
				var bs = "";
				if (start === 0) {
					seqbyte |= HCode.SPLIT_START;
					bs += "START ";
				}
				seqbyte |= HCode.SPLIT_MIDDLE;
				bs += "MIDDLE ";
				if (size === bytes.length) {
					seqbyte |= HCode.SPLIT_END;
					bs += "END";
				}
				header[1] = seqbyte;
				futureSend(connection, connection.packetPrefix);
				futureSend(connection, header);
				futureSend(connection, bytes.slice(0, size));
				futureSend(connection, connection.frame);
			}
		} else {
			futureSend(connection, connection.packetPrefix);
			futureSend(connection, data);
			futureSend(connection, connection.frame);
		}
	}
}


function habitatPacketHeader(start, end, seq, noid, reqNum) {
	var r = [];
	r[0] = HCode.MICROCOSM_ID_BYTE;
	r[1] = (seq | (end   ? 0x80 : 0x00) | 0x40 | (start ? 0x20 : 0x00)) & HCode.BYTE_MASK;
	if (undefined !== noid)   {r[2] = noid   & HCode.BYTE_MASK; }
	if (undefined !== reqNum) {r[3] = reqNum & HCode.BYTE_MASK; }
	return r;
}

function habitatAsyncPacketHeader(start, end, noid, reqNum) {
	return habitatPacketHeader(start, end, 0x1A, noid, reqNum);
}


var HabBuf = function (start, end, seq, noid, reqNum) {
	this.data = [];
	if (undefined !== start) {
		this.data = this.data.concat(habitatPacketHeader(start, end, seq, noid, reqNum));
	}
	this.send = function (client, split) {
		Trace.debug(JSON.stringify(this.data) + " -> client (" + client.sessionName + ")");
		toHabitat(client, Buffer.from(this.data, 'binary'), split);
	};
	this.add  = function (val) {
		if (Array.isArray(val)) {
			this.data = this.data.concat(val);
		} else {
			this.data.push(val);
		}
	};
};

var unpackHabitatObject = function (client, o, containerRef) {
	var mod  			= o.obj.mods[0];
	o.noid				= mod.noid || 0;
	o.mod				= mod;
	o.ref			 	= o.obj.ref;
	o.className		 	= mod.type;
	o.classNumber	 	= HCode.CLASSES[mod.type] || 0;	

	if (o.noid == UNASSIGNED_NOID) {
		return true;					// Ghost Hack: Items/Avatars ghosted have an UNASSIGNED_NOID
	}

	if (undefined === HCode[mod.type]) {
		Trace.error("\n\n*** Attempted to instantiate class '" + o.className + "' which is not supported. Aborted make. ***\n\n");
		return false;
	}

	o.clientMessages 	= HCode[mod.type].clientMessages;
	o.container 	 	= client.state.refToNoid[containerRef] || 0;

	client.state.objects[o.noid]    = o;
	client.state.refToNoid[o.ref]	= o.noid;
	return true;
}

var vectorize = function (client, newObj , containerRef) {
	var o = {obj: newObj};		
	if (undefined == newObj || !unpackHabitatObject(client, o , containerRef)) return null;	

	var buf = new HabBuf();
	buf.add(o.noid);
	buf.add(o.classNumber);
	buf.add(0);
	habitatEncodeElkoModState(o.mod, o.container, buf);
	buf.add(0);
	return buf.data;
}

var ContentsVector = function (replySeq, noid, ref, type) {
	this.container		= new HabBuf();
	this.contents		= {};
	this.containers		= {};
	this.containerRef   = ref;
	this.containerNoid  = noid;
	this.replySeq		= (undefined === replySeq)	? HCode.PHANTOM_REQUEST : replySeq;
	this.type			= (undefined === type)		? HCode.MESSAGE_DESCRIBE : type;
	if (undefined !== noid) {
		this.containers[noid] = this;
	}	
	this.add = function (o) {
		var mod = o.obj.mods[0];
		if (undefined === this.containerRef) {
			this.containerRef  = o.to;
			this.containerNoid = mod.noid;
			this.containers[this.containerNoid] = this;
		}
		if (mod.noid !== this.containerNoid) {
			o.clientStateBundle = new HabBuf();
			habitatEncodeElkoModState(mod, o.container, o.clientStateBundle);
			if (undefined === this.containers[this.containerNoid].contents[o.to]) {
				this.containers[this.containerNoid].contents[o.to] = [];
			}
			this.containers[this.containerNoid].contents[o.to].push(mod.noid);
		} else {
			habitatEncodeElkoModState(mod, o.container, this.containers[this.containerNoid].container);
		}
	};
	this.send = function (client) {	
		client.NoidContents = {};
		client.NoidClassList = [];
		client.ObjectStateBundles = new HabBuf();
		var buf = new HabBuf(
				true,
				true,
				this.replySeq,
				HCode.REGION_NOID,
				this.type);
		if (this.type == HCode.MESSAGE_DESCRIBE) { 
			if (this.container.data[4] == UNASSIGNED_NOID) {
				av = client.state.avatar; // Since the region arrives before the avatar, we need to fix some state...
				this.container.data[4] = av.amAGhost ? 255 : av.noid; 
				this.container.data[8] = ((av.bankBalance & 0xFF000000) >> 24);
				this.container.data[7] = ((av.bankBalance & 0x00FF0000) >> 16);
				this.container.data[6] = ((av.bankBalance & 0x0000FF00) >> 8);
				this.container.data[5] = ((av.bankBalance & 0x000000FF));
			}
			buf.add(this.container.data);
		}
		// Make nested contents noid-based...
		for (cont in this.contents) {
			var contnoid = client.state.refToNoid[cont] || 0;
			client.NoidContents[contnoid] = this.contents[cont];
		}
		// start recursively adding contents, properly in order.
		addContentsToCV(client, 0);
//		Trace.debug("\n\n\n" + JSON.stringify(this.contents) + "\n"
//				 + JSON.stringify(client.NoidContents) + "\n"
//				 + JSON.stringify(client.NoidClassList) + "\n"
//				 + JSON.stringify(client.ObjectStateBundles.data) + "\n\n\n" );		
		buf.add(client.NoidClassList)
		buf.add(0);
		buf.add(client.ObjectStateBundles.data);
		buf.add(0);
		buf.send(client, true);
	};
};

function addContentsToCV(client, contnoid) {
	for (item in client.NoidContents[contnoid]) {
		var noid = client.NoidContents[contnoid][item];
		var o    = client.state.objects[noid];
		var mod  = o.obj.mods[0];
		if (undefined !== client.NoidContents[noid]) {
			// item IS a container with contents, so write those contents first. Recurse!					
			addContentsToCV(client, noid);			
		}
		client.NoidClassList.push(noid, HCode.CLASSES[mod.type]);
		client.ObjectStateBundles.add(o.clientStateBundle.data);
	}
}

function toElko(connection, data) {
	connection.write(data + "\n\n");
}

const UNKNOWN_FRAME		= 0;
const DELIMITED_FRAME	= 1;
const QLR_FRAME			= 2;
const QLINK_FRAME		= 3;

function initializeClientState(client, who, replySeq) {
	++SessionCount;
	client.sessionName = "" + SessionCount;
	client.inputBuf    = [];
	client.framingMode = UNKNOWN_FRAME;
	client.state = { user: who || "",
			contentsVector: new ContentsVector(replySeq, HCode.REGION_NOID),
			objects: [],
			refToNoid: {},
			numAvatars: 0,
			waitingForAvatar: true,
			waitingForAvatarContents: false,
			otherContents: [],
			otherNoid: 0,
			otherRef: "",
			ghost: false,
			replySeq: replySeq
	};
}


function frameClientStream(client, server, data) {
	var framed   = false;
	var saveC	 = "";
		
	// First try do discover a QLR frame:  NAME:QLINKPACKET
	if (client.framingMode == UNKNOWN_FRAME) {
		var s 	 	= data.toString().trim();
		var colon	= s.indexOf(":");
		var Z		= s.indexOf("Z");
		if (colon > 0 && (colon + 1) == Z) {
			client.framingMode = QLR_FRAME;
		}
	}
	if (client.framingMode == QLINK_FRAME || client.framingMode == QLR_FRAME) {	// If we know this is a FULL Qlink/QLR protocol packet, process now.
		parseIncomingHabitatClientMessage(client, server, data);
		return;
	}

	// This is either PARTIAL lf-lf delimited JSON packet OR we still don't know what kind of packet it is yet
	for (var i = 0; i < data.length; i++) {
		var c = data[i];
		if (client.framingMode == UNKNOWN_FRAME) {		// zip through the data looking for the starting signature byte
			if (c == "{") {
				client.framingMode	= DELIMITED_FRAME;	// JSON is always lf-lf delimited
			} else if (c == "Z") {
				client.framingMode = QLINK_FRAME;		// Start processing QLINK messages on this connection.
				parseIncomingHabitatClientMessage(client, server, data.slice(i));  // And process this one.
				return;
			}
		}
		if (client.framingMode == DELIMITED_FRAME) {
			client.inputBuf += c;
			if (c == '\n' || c == '\r') {		// Two returns-delimited frames on streams.
				if (client.saveFrameChar == '\n' || client.saveFrameChar == '\r') {
					framed = true;
				}
			}
			if (framed) {
				parseIncomingHabitatClientMessage(client, server, client.inputBuf);
				client.inputBuf = [];
				c = "";
			}
			client.saveFrameChar = c;
		}
	}
}


/**
 * 
 * @param client
 * @param server
 * @param data
 */
function parseIncomingHabitatClientMessage(client, server, data) {
	var send = data.toString().trim();

	// Handle new connections - determine the protocol/device type and setup environment

	if (undefined === client.json) {
		var curly = send.indexOf("{");
		var colon = send.indexOf(":");
		if (curly !== -1 && curly < colon) {
			client.json			= true;
			client.binary		= false;
			client.frame    	= "\n\n";		
		} else if (colon !== -1) {			// Hacked Qlink bridge doesn't send QLink header, but a user-string instead.
			client.packetPrefix	= send.substring(0, colon + 1);
			client.json 		= false;
			client.binary		= true;
			client.frame		= String.fromCharCode(HCode.END_OF_MESSAGE);
			// overload write function to do handle escape! 			
			client.rawWrite = client.write;
			client.write = function(msg) {
				if (isString(msg)) {
					client.rawWrite(msg);
				} else {
					client.rawWrite(Buffer.from(escape(msg)));
				}
			};
			client.userRef = confirmOrCreateUser(send.substring(0, colon), client);		// Make sure there's one in the NeoHabitat/Elko database.
			Trace.debug(client.sessionName + " (Habitat Client) connected.");
		}
	}

	// Unpack the message and deal with any special protocol transformations.

	if (client.json) {

		if (send.indexOf("{") < 0) { return; }	// Empty JSON text frame ignore without warning.

		var o = {};
		try {
			o = JSON.parse(send);
			if (o && o.op) {
				if (o.op === "entercontext") {
					Trace.debug(o.user + " is trying to enter region-context " + o.context);	
					confirmOrCreateUser(o.user.substring("user-".length), client);
				}
			}
		} catch (e) {
			Trace.warn("JSON.parse faiure client (" + client.sessionName + ") ->  Ignoring: " + JSON.stringify(send) + "\n" + JSON.stringify(e));
			return;
		}
		Trace.debug(client.sessionName + " -> " + JSON.stringify(o) + " -> server ");
		toElko(server, send);
	} else if (client.binary) {
		parseHabitatClientMessage(client, server, data);
	} else {
		Trace.debug("client (" + client.sessionName + ") -> Garbage message arrived before protocol resolution. Ignoring: " + JSON.stringify(data));
		return;
	}	
}

function parseHabitatClientMessage(client, server, data) {
	var hMsg    = descape(data.getBytes(), client.packetPrefix.length + 8);
	var seq 	= hMsg[1] & 0x0F;
	var end 	= ((hMsg[1] & 0x80) === 0x80);
	var start	= ((hMsg[1] & 0x20) === 0x20);
	var noid	= hMsg[2] || 0;
	var reqNum	= hMsg[3] || 0;
	var args	= hMsg.slice(4);
	var msg;

	Trace.debug("client (" + client.sessionName + ") ->  [noid:" + noid +
			" request:" + reqNum + " seq:" + seq + " ... " + JSON.stringify(args) + "]");

	if (undefined === client.connected) {
		client.state.who = client.packetPrefix;
		client.connected = true;
		// SHORT CIRCUIT: Direct reply to client without server... It's too early to use this bridge at the object level.
		var aliveReply = new HabBuf(true, true, HCode.PHANTOM_REQUEST, HCode.REGION_NOID, HCode.MESSAGE_IM_ALIVE);
		aliveReply.add(1  /* SUCCESS */);
		aliveReply.add(48 /* "0" */);
		aliveReply.add("BAD DISK".getBytes());
		aliveReply.send(client);
		return;	
	} else {
		if (seq !== HCode.PHANTOM_REQUEST) {
			client.state.replySeq = seq;	// Save sequence number sent by the client for use with any reply.
		}
		if (noid === HCode.REGION_NOID) {
			if (reqNum === HCode.MESSAGE_DESCRIBE) {
				// After a (re)connection, only the first request for a contents vector is valid
				var context;
				if (undefined === client.state.nextRegion) {
					if (client.user && client.user.mods[0].lastArrivedIn) {
						context = client.user.mods[0].lastArrivedIn;
						client.user.mods[0].lastArrivedIn = "";
					} else {
						choices = ["context-library"/* ,"context-Downtown_3b","context-Downtown_7g","context-Downtown_7b","context-Downtown_3j" */];
						context = choices[rnd(choices.length)];
					}
				} else if (client.state.nextRegion !== "") {
					context = client.state.nextRegion;
				} else {
					return;	// Ignore this request, the client is hanging but a changecontext/immdiate message is coming to fix this.
				}
				enterContext(client, server, context);
				client.firstConnection = false;
				return;
			}
		}
	}

	// All special cases are resolved. If we get here, we wanted to send the message as-is to the server to handle.

	var o	  	= client.state.objects[noid];
	var op	  	= (undefined === o.clientMessages[reqNum]) ? "UNSUPPORTED" : o.clientMessages[reqNum].op;
	var ref  	= o.ref;
	msg   		= {"to":ref, "op":op};   // Default Elko-Habitat message header

	if ("UNSUPPORTED" === op) {
		Trace.warn("*** Unsupported client message " + reqNum + " for " + ref + ". ***");
		return;
	}

	if (undefined !== HCode.translate[op]) {
		client.state.replyEncoder = HCode.translate[op].toClient;
		if (undefined !== HCode.translate[op].toServer) {
			HCode.translate[op].toServer(args, msg, client, start, end);
			if (msg.suppressReply) {
				return;
			}
		}
	}

	if (msg) {
		toElko(server, JSON.stringify(msg));
		Trace.debug(JSON.stringify(msg) + " -> server (" + client.sessionName + ")");
	}

	return;
}

function enterContext(client, server, context) {
	var replySeq = (undefined === context) ? HCode.PHANTOM_REQUEST : client.state.replySeq;
	var enterContextMessage =	{
			to:			"session",	
			op:			"entercontext",
			context:	context,
			user:		client.userRef
	}
	Trace.debug("Sending 'entercontext' to " + enterContextMessage.context  +" on behalf of the Habitat client.");
	toElko(server, JSON.stringify(enterContextMessage));
	initializeClientState(client, client.userRef, replySeq);
	client.state.nextRegion = "";
}

function removeNoidFromClient(client, noid) {
	if (noid) {
		var o = client.state.objects[noid];
		var buf = new HabBuf(
				true,
				true,
				HCode.PHANTOM_REQUEST,
				HCode.REGION_NOID,
				HCode.MESSAGE_GOAWAY);
		buf.add(noid);
		buf.send(client);

		delete client.state.refToNoid[o.ref];
		delete client.state.objects[noid];
		if (o.className === "Avatar") {
			client.state.numAvatars--;
		}
	}
}

var encodeState = {
		common: function (state, container, buf) {
			if (undefined === buf) {
				buf = new HabBuf();
			}
			buf.add(state.style 		|| 0);
			buf.add(state.x	   			|| 0);
			buf.add(state.y				|| 0);
			buf.add(state.orientation	|| 0);
			buf.add(state.gr_state		|| 0);
			buf.add(container			|| 0);
			return buf;
		},
		document:  function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.last_page		|| 0);
			return buf;
		},
		magical: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.magic_type	|| 0);
			return buf;
		},
		massive: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.mass || 0);
			return buf;
		},
		toggle: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.on || 0);
			return buf;
		},
		openable: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.open_flags	|| 0);
			buf.add(state.key_lo		|| 0);
			buf.add(state.key_hi		|| 0);
			return buf;
		},
		walkable: function (state, container, buf) {
			buf = this.common(state, container, buf);
//			buf.add(state.flat_type	|| 0);			 TODO Check to see if this is a server only property.
			return buf;
		}, 
		polygonal: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.trapezoid_type	|| 0);
			buf.add(state.upper_left_x		|| 0);
			buf.add(state.upper_right_x		|| 0);
			buf.add(state.lower_left_x		|| 0);
			buf.add(state.lower_right_x		|| 0);
			buf.add(state.height			|| 0);
			return buf;
		},
		Region: function (state, container, buf) {
			if (undefined === buf) {
				buf = new HabBuf();
			}
			var bal = state.bankBalance ||  0;
			buf.add(state.terrain_type	||  0);
			// Sets default Region lighting at 1 if no lighting specified.
			if (state.lighting === undefined) {
				buf.add(1);
			} else {
				buf.add(state.lighting);
			}
			buf.add(state.depth			|| 32);
			buf.add(state.region_class	||  0);
			buf.add(state.Who_am_I		|| UNASSIGNED_NOID);    	
			buf.add(0); // Bank account balance is managed once we get the avatar object for this connection.
			buf.add(0);
			buf.add(0);
			buf.add(0);
			return buf;
		},
		Avatar: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.activity	||   0);
			buf.add(state.action	||   0);			
			buf.add(state.health	|| 255);
			buf.add(state.restrainer||   0);
			buf.add(state.custom	||  [0, 0]);
			return buf;
		},
		Key: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.key_number_lo	||   0);
			buf.add(state.key_number_hi	||   0);
			return buf;
		},
		Sign:  function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.ascii);
			return buf;
		},
		Street:  function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.width);
			buf.add(state.height);
			return buf;
		},
		Super_trapezoid: function (state, container, buf) {
			buf = this.polygonal(state, container, buf);
			buf.add(state.pattern_x_size);
			buf.add(state.pattern_y_size);
			buf.add(state.pattern);
			return buf;
		},
		Grenade: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.pinpulled || 0);
			return buf;
		},
		Glue: function (state, container, buf) {
			buf = this.openable(state, container, buf);
			buf.add(state.x_offset_1 || 0 );
			buf.add(state.y_offset_1 || 0 );
			buf.add(state.x_offset_2 || 0 );
			buf.add(state.y_offset_2 || 0 );
			buf.add(state.x_offset_3 || 0 );
			buf.add(state.y_offset_3 || 0 );
			buf.add(state.x_offset_4 || 0 );
			buf.add(state.y_offset_4 || 0 );
			buf.add(state.x_offset_5 || 0 );
			buf.add(state.y_offset_5 || 0 );
			buf.add(state.x_offset_6 || 0 );
			buf.add(state.y_offset_6 || 0 );
			return buf;
		}, 
		Die:  function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.state || 0);
			return buf; 
		},
		Drugs:  function(state, container, buf) {
 			buf = this.common(state, container, buf);
 			buf.add(state.count || 0);
 			return buf; 
 		},
		Fake_gun: function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.state || 0);
			return buf; 
		},
		Flat: function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.flat_type || 0);
			return buf;
		},
		Tokens:  function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.denom_lo);
			buf.add(state.denom_hi);
			return buf;
		},
		Bottle:  function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.filled);
			return buf;
		},
		Bridge:  function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.width);
			buf.add(state.height);
			return buf;
		},
		Bureaucrat:  function(state, container, buf) {
			buf = this.common(state, container, buf);
			return buf;
		},
		Teleport: function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.activeState || 0);
			return buf;
		},
		Picture: function (state, container, buf) {
			buf = this.massive(state, container, buf);
			buf.add(state.picture || 0);
			return buf;
		},
		Vendo_front: function (state, container, buf) {
			buf = this.openable(state, container, buf);
			buf.add(state.price_lo		|| 0);
			buf.add(state.display_item	|| 0);
			return buf;
		},
		Escape_device: function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.charge || 0);
			return buf;
		},
		Elevator: function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.activeState || 0);
			return buf;
		},
		Windup_toy: function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.wind_level || 0);
			return buf;
		},
		Magic_lamp: function(state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.lamp_state);
			buf.add(state.wisher);
			return buf;
		},
		Aquarium: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.fed || 0);
			return buf;
		},
		Amulet:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Atm:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Bag: 			function (state, container, buf) { return (this.openable(state, container, buf)); },
		Ball:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Bed:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Book:			function (state, container, buf) { return (this.document(state, container, buf)); },
		Box:			function (state, container, buf) { return (this.openable(state, container, buf)); },
		Building:		function (state, container, buf) { return (this.common	(state, container, buf)); },
		Bush: 			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Chair:  	    function (state, container, buf) { return (this.common  (state, container, buf)); },
		Changomatic:  	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Chest:			function (state, container, buf) { return (this.openable(state, container, buf)); },
		Club:  			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Coke_machine:	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Compass:  		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Couch:  	    function (state, container, buf) { return (this.common  (state, container, buf)); },
		Countertop:		function (state, container, buf) { return (this.openable(state, container, buf)); },
		Crystal_ball:	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Display_case:	function (state, container, buf) { return (this.openable(state, container, buf)); },
		Door:			function (state, container, buf) { return (this.openable(state, container, buf)); },
		Dropbox: 		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Fence:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Flag: 			function (state, container, buf) { return (this.massive (state, container, buf)); },
		Flashlight: 	function (state, container, buf) { return (this.toggle  (state, container, buf)); },
		Floor_lamp: 	function (state, container, buf) { return (this.toggle  (state, container, buf)); },
		Fortune_machine:function (state, container, buf) { return (this.common  (state, container, buf)); },
		Fountain:		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Frisbee:		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Gemstone:		function (state, container, buf) { return (this.magical (state, container, buf)); },
		Game_piece: 	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Garbage_can: 	function (state, container, buf) { return (this.openable(state, container, buf)); },
		Ghost:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Ground:			function (state, container, buf) { return (this.walkable(state, container, buf)); },
		Gun:	  		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Head:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Hole:			function (state, container, buf) { return (this.openable(state, container, buf)); },		
		Hot_tub:	    function (state, container, buf) { return (this.common  (state, container, buf)); },
		House_cat:  	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Knick_knack:	function (state, container, buf) { return (this.magical (state, container, buf)); },
		Knife:  		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Magic_immobile:	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Magic_staff:	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Magic_wand:		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Mailbox: 		function (state, container, buf) { return (this.massive  (state, container, buf)); },
		Matchbook:  	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Movie_camera: 	function (state, container, buf) { return (this.toggle  (state, container, buf)); },
		Paper: 			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Pawn_machine:	function (state, container, buf) { return (this.openable(state, container, buf)); },
		Plant:	 		function (state, container, buf) { return (this.massive (state, container, buf)); },
		Plaque:			function (state, container, buf) { return (this.document(state, container, buf)); },
		Pond: 			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Ring:			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Rock: 			function (state, container, buf) { return (this.massive (state, container, buf)); },
		Roof:	 		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Safe:			function (state, container, buf) { return (this.openable(state, container, buf)); },
		Sensor:         function (state, container, buf) { return (this.common  (state, container, buf)); },
		Sex_changer:	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Short_sign:		function (state, container, buf) { return (this.Sign	(state, container, buf)); },
		Shovel:   		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Sky: 			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Spray_can:  	function (state, container, buf) { return (this.common  (state, container, buf)); },
		Streetlamp:		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Stun_gun:  		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Table:			function (state, container, buf) { return (this.openable(state, container, buf)); },
		Trapezoid: 		function (state, container, buf) { return (this.polygonal(state,container, buf)); },
		Tree: 			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Vendo_inside:	function (state, container, buf) { return (this.openable(state, container, buf)); },
		Wall: 			function (state, container, buf) { return (this.common  (state, container, buf)); },
		Window:	     	function (state, container, buf) { return (this.common  (state, container, buf)); }
};

function habitatEncodeElkoModState (state, container, buf) {
	return encodeState[state.type](state, container, buf);
}

function diagnosticMessage(client, text, noid) {
	noid = noid || REGION_NOID;
	var msg = new HabBuf(
			true,
			true,
			HCode.PHANTOM_REQUEST,
			HCode.REGION_NOID,
			HCode.SERVER_OPS["OBJECTSPEAK_$"].reqno);
	msg.add(noid),
	msg.add(text.getBytes());
	msg.send(client);
}

function checkpointUsers() {
	var save = {};
	for (key in Users) {
		save[key] = ({regionRef:Users[key].regionRef, userRef:Users[key].userRef});
	}
	File.writeFile(UFILENAME, JSON.stringify(save, null, 2));
}

function findUser(name) {
	name = name.toLowerCase();
	for (key in Users) {
		if (name == key.toLowerCase()) {
			return key;
		}
	}
	return name;
}


function parseIncomingElkoServerMessage(client, server, data) {
	var o = {};

	try {
		o = JSON.parse(data);
	} catch (e) {
		Trace.warn("JSON.parse faiure server (" + client.sessionName + ") ->  Ignoring: " + JSON.stringify(data) + "\n" + JSON.stringify(e));
		return;
	}

	if (o.to === "session") {
		if (o.op === "exit") {
			var reason = "Server forced exit [" + o.whycode + "] " + o.why;
			if (undefined !== client.avatarNoid && client.binary) {
				diagnosticMessage(client, reason, client.avatarNoid);
			}
			Trace.warn(reason);
			return;
		}
	}

	if (o.op && o.op === "make" && o.you) {	// This connection's avatar has arrived - we have a habitat session!
		var name      = o.obj.name;
		var mod       = o.obj.mods[0];
		var regionRef = o.to.split("-");
		var userRef   = o.obj.ref.split("-");
		Users[name] = {
				regionRef:	regionRef[0] + "-" + regionRef[1],
				userRef:    userRef[0]   + "-" + userRef[1],
				client:		client,
				online:		true};
		checkpointUsers();
		client.sessionName 				+= ":" + name;
		client.userName					= name;
		client.avatarNoid   			= mod.noid;
		client.waitingForAvatarContents = true;
	}


	if (o.type === "changeContext") {
		client.state.nextRegion = o.context;		// Save for MESSAGE_DESCRIBE to deal with later.
		var immediate = o.immediate || false;			// Force enterContext after reconnect? aka Client has prematurely sent MESSAGE_DESCRIBE and we ignored it.
		createServerConnection(client.port, client.host, client, immediate, o.context); 
		// create a new connection for the new context
		return true; 								// Signal this connection to die now that it's obsolete.
	}

	if (o.op === "ready") {
		if (client.state.waitingForAvatarContents) {
			client.state.waitingForAvatar 		  = false;
			client.state.waitingForAvatarContents = false;

			if (client.json) { // We might have to tell the server that the avatar is visible - emulating C64 client behavior.
				toElko(server, JSON.stringify({ to:o.to, op:"FINGER_IN_QUE"}));
				toElko(server, JSON.stringify({ to:o.to, op:"I_AM_HERE"}));
				return;
			}
			for (var i = 0; i < client.state.objects.length; i++) {
				var itm = client.state.objects[i];
				if (undefined !== itm)
					client.state.contentsVector.add(itm);
			}
			Trace.debug(client.state.user +
					    " known as object ref " + 
					    client.state.ref + 
					    " in region/context " + 
					    client.state.region + 
					    (client.state.avatar.amAGhost ? " (GHOSTED)." : "."));
			client.state.contentsVector.send(client);
			
			client.state.contentsVector =  new ContentsVector(); 		// May be used by HEREIS/makes after region arrival
			
//			if (client.state.numAvatars === 1) {
//				var caughtUpMessage = new HabBuf(true, true, HCode.PHANTOM_REQUEST, HCode.REGION_NOID, HCode.MESSAGE_CAUGHT_UP);
//				caughtUpMessage.add(1);			// TRUE
//				caughtUpMessage.send(client);
//			}
			return;
		}
		if (client.state.otherNoid) {		// Other avatar needs to go out as one package.	
			if (client.state.otherNoid != UNASSIGNED_NOID) {
				for (var i = 0; i < client.state.otherContents.length; i++) {
					if (undefined !== client.state.otherContents[i]) {
						client.state.contentsVector.add(client.state.otherContents[i]);
					}
				}
				client.state.contentsVector.send(client);	// Suppress client send for ghosted avatar-connections.
			}
			client.state.otherContents	= [];
			client.state.otherNoid		= 0;
			client.state.otherRef		= "";
			client.state.contentsVector = new ContentsVector();
			return;
		}
		// Eat this, since Elko thinks the region's done and the avatar will arrive later
		// Habitat wants the user's avatar as part of the contents vector.
		return;
	}

//	JSON client is just a relay...
	if (client.json) {
		Trace.debug("server (" + client.sessionName + ") -> "  + JSON.stringify(o) + " -> client (" + client.sessionName + ")");
		toHabitat(client, o);
		return;
	}

//	NEXT UP, TRANSFORM ANY LOGIC

	/* Mapping change region (choosing a canonical direction) to change context
	   is awkward. Habitat wants to send a NEWREGION command and a canonical
	   compass direction. Elko wants to respond to the request with permission
	   to set the user's context to the credentials it supplies, in effect telling
	   the client to "Ask me again to connect to such-and-such-a-place with these
	   credentials."

	   I simply am having the bridge do the extra round trip on behalf of the
	   Habitat Client. 	
	 */

	if (undefined === data || (undefined === o.op && undefined === o.type)) {
		Trace.warn("Badly formatted server message! Ignored: " + JSON.stringify(o));
		return;
	}

	Trace.debug("server (" + client.sessionName + ") -> " + JSON.stringify(o));

	/*	changeContext means that Elko wants the user to request a new context.
			The bridge will handle this, as this round-trip doesn't involve the 
		 	Habitat client. See the MESSAGE_DESCRIBE to see the followup... */



	if (o.op === "delete") {
		var target = client.state.refToNoid[o.to];
		if (target) 
			removeNoidFromClient(client, target );
		return;
	}

	if (o.op === "make") {
		var mod  = o.obj.mods[0];

		if (!unpackHabitatObject(client, o, o.to)) return;

		if (o.className === "Avatar") {
			client.state.numAvatars++;
			if (!o.you) {
				if (undefined == mod.sittingIn || mod.sittingIn == "") {
					o.container = 0;
				} else {
					o.container 	= mod.sittingIn;			// Pretend this avatar is contained by the seat.
					mod.y			= mod.sittingSlot;
					mod.activity	= mod.sittingAction;
					mod.action		= mod.sittingAction;
				}
			}
			if (!o.you && !client.state.waitingForAvatar) { // Async avatar arrival wants to bunch up contents.
				client.state.otherNoid		= o.noid;
				client.state.otherRef		= o.ref;
				client.state.otherContents.push(o);
				client.state.contentsVector	= 
					new ContentsVector(HCode.PHANTOM_REQUEST, HCode.REGION_NOID, o.to, HCode.MESSAGE_HEREIS);
				return;
			}
		}
		if (client.state.waitingForAvatar) {
			if (o.you) {
				client.state.ref    					= o.ref;
				client.state.region 					= o.to;
				client.state.avatar						= mod;
				client.state.waitingForAvatarContents	= true;				
				// The next "ready" will build the full contents vector and send it to the client.
			}
			return;
		}
		if (client.state.otherNoid != 0) {		// Keep building other's content list.
			o.container							= client.state.otherNoid;
			client.state.otherContents.push(o);	// This will get sent on "ready"
			return
		}
		// Otherwise this is a simple object that can be sent out one thing at a time.
		Trace.debug("server (" + client.sessionName + ")  make -> HEREIS");
		var buf = new HabBuf(
				true,
				true,
				HCode.PHANTOM_REQUEST,
				HCode.REGION_NOID,
				HCode.MESSAGE_HEREIS);
		buf.add(o.noid);
		buf.add(o.classNumber);
		buf.add(0);
		habitatEncodeElkoModState(mod, o.container, buf);
		buf.add(0);
		buf.send(client, true);
		return;
	}

//	End of Special Cases - parse the reply/broadcast/neighbor/private message as a object-command.
	encodeAndSendClientMessage(client, o); 
}

function encodeAndSendClientMessage(client, o) {
	var split = false;
	if (o.type === "reply") {
		var buf = new HabBuf(true, true, client.state.replySeq, o.noid, o.filler);
		if (undefined !== client.state.replyEncoder) {
			split = client.state.replyEncoder(o, buf, client);
		}
		buf.send(client, split);
		return;
	}

	if (undefined !== HCode.SERVER_OPS[o.op]) {
		o.reqno		= HCode.SERVER_OPS[o.op].reqno;
		o.toClient	= HCode.SERVER_OPS[o.op].toClient;
		var buf = new HabBuf(true, true, HCode.PHANTOM_REQUEST, o.noid, o.reqno);
		if (undefined !== o.toClient) {
			split = o.toClient(o, buf, client);
		}
		buf.send(client, split);
		return;
	} else {
		Trace.warn("Message from server headed to binary client not yet converted. IGNORED:\n");
		return;

	}
}


function processIncomingElkoBlob(client, server, data) {
	var framed = false;
	var firstEOL = false;
	var JSONFrame = "";
	var blob = data.toString();
	for (var i=0; i < blob.length; i++) {
		var c = blob.charCodeAt(i);
		if (framed) {
			JSONFrame += String.fromCharCode(c);
			if (10 === c) {
				if (!firstEOL) {
					firstEOL = true;
				} else {
					if (parseIncomingElkoServerMessage(client, server, JSONFrame)) {
						return true;		// Abort and pass along signal that this connection must reset.
					}
					framed = false;
					firstEOL = false;
					JSONFrame = "";
				}
			}
		} else {
			if (123 === c) {
				framed = true;
				firstEOL = false;
				JSONFrame = "{";
			} else {
				Trace.warn("IGNORED: " + c);
			}
		}
	}
	if (framed) {
		Trace.error("INCOMPLETE FRAME: " + JSONFrame);
	}
}



//Create a server instance, and chain the listen function to it
//The function passed to net.createServer() becomes the event handler for the 'connection' event
//The sock object the callback function receives is UNIQUE for each connection

const Listener = Net.createServer(function(client) {
	// We have a Habitat Client connection!
	client.setEncoding('binary');
	client.port				= ElkoPort;
	client.host				= ElkoHost;
	client.timeLastSent		= new Date().getTime();
	client.lastSentLen		= 0;
	client.firstConnection	= true;
	client.user				= null;
	client.backdoor			= {vectorize: vectorize};
	initializeClientState(client);

	Trace.debug('Habitat connection from ' + client.address().address + ':'+ client.address().port);
	try {
		createServerConnection(client.port, client.host, client);
	} catch (e) {
		Trace.error(e.toString());
	}
}).listen(ListenPort, ListenHost);

Trace.info('Habitat to Elko Bridge listening on ' + ListenHost +':'+ ListenPort);
