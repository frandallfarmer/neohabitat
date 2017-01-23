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

const DefDefs	= { context:	'context-test',
		            listen:		'127.0.0.1:1337',
		            elko:		'127.0.0.1:9000',
		        	mongo:		'//127.0.0.1:27017/elko',
		            rate:		1200,
		            trace:		'info'};
var	 Defaults	= DefDefs;

try {
	var userDefs = JSON.parse(File.readFileSync("defaults.elko"));
	Defaults = { context:	userDefs.context || DefDefs.context,
				 listen:	userDefs.listen	 || DefDefs.listen,
				 elko:		userDefs.elko	 || DefDefs.elko,
				 mongo:		userDefs.mongo   || DefDefs.mongo,
				 rate:		userDefs.rate	 || DefDefs.rate,
				 trace:		userDefs.trace	 || DefDefs.trace};
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
		.argv;

Trace.level 	 = Argv.trace;

const HCode		 = require('./hcode');
const Millis	 = 1000;
const UFILENAME	= "./usersDB.json";

var	  UserDB = {};
try {
	UserDB	= JSON.parse(File.readFileSync(UFILENAME));
} catch (e) { /* do nothing */ }

var listenaddr	 = Argv.listen.split(":");
var elkoaddr	 = Argv.elko.split(":");
var ListenHost	 = listenaddr[0];
var ListenPort	 = listenaddr.length > 1 ? parseInt(listenaddr[1]) : 1337;
var ElkoHost	 = elkoaddr[0];
var ElkoPort	 = elkoaddr.length > 1   ? parseInt(elkoaddr[1])   : 9000;

var SessionCount = 0;
var MongoDB = {};


function rnd(max) {
	return Math.floor(Math.random() * max)
}

function testUser(db, query, callback) {
	db.collection('odb').findOne(query, callback);
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

function confirmOrCreateUser(fullName) {
	var userRef = "user-" + fullName.toLowerCase()
	MongoClient.connect("mongodb:" + Argv.mongo, function(err, db) {
		Assert.equal(null, err);
		testUser(db, {ref: userRef}, function(err, result) {
			if (result === null || Argv.force) {
				
				insertUser(db, {
					"type": "user",
					"ref": userRef,
					"name": fullName,
					"mods": [
						{
							"type": "Avatar",
							"x": 10,
							"y": 128 + rnd(32),
							"bodyType": "male",
							"bankBalance": 5000,
							"custom": [rnd(15) + rnd(15)*16, rnd(15) + rnd(15)*16],
							"nitty_bits": 0
						}
						]
				}, function() {
					db.close();
				});
				
			} else {
				db.close();
			}
		});
	});
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

/*
 * Elko uses a fresh connection for every context/region change.
 */
function createServerConnection(port, host, client) {

	var server = Net.connect({port: port, host:host}, function() {
		Trace.debug( "Connecting: " + 
				client.address().address +':'+ client.address().port +
				" <-> " +
				server.address().address + ':'+ server.address().port);

		server.on('data', function(data) {
			var reset = false;
			try {
				reset = processIncomingElkoBlob(client, server, data);				
			} catch(err) {
				Trace.error("\n\n\nServer input processing error captured:\n" +
							err.message + 
							"\n...resuming...\n");
			}
			if (reset) {				// This connection has been replaced due to context change.
				Trace.debug("Destroying connection: " + server.address().address + ':' + server.address().port);
				server.destroy();
			}
		});

		// What if the Elko server breaks the connection? For now we tear the bridge down also.
		// If we ever bring up a "director" based service, this will need to change on context changes.

		server.on('end', function() {
			Trace.debug('Elko port disconnected...');
			if (client) {
				Trace.debug("Bridge being shutdown...");
				client.end();
			}
		});
		
		client.removeAllListeners('data').on('data', function(data) {
			try {
				parseIncomingHabitatClientMessage(client, server, data);				
			} catch(err) {
				Trace.error("\n\n\nClient input processing error captured:\n" + 
							JSON.stringify(err,null,2) +
							"\n...resuming...\n");
			}
		});

		client.removeAllListeners('close').on('close', function(data) {
			Trace.debug("Habitat client disconnected.");
			if (server) { server.end();}
		});
	});
}

function isString(data) {
	return (typeof data === 'string' || data instanceof String);
}

function futureSend(connection, data) {
	var now  = new Date().getTime();
	var when = Math.ceil(connection.timeLastSent + connection.lastSentLen * 8 / Argv.rate * Millis);
	
	connection.lastSentLen = data.length;
	if (when <= now) {
		connection.write(data);
		connection.timeLastSent = now;
	} else {
		var delay = Math.ceil(Math.max(0, (when - now)));
		var msg = (isString(data)) ? data : Buffer.from(escape(data));
		setTimeout(function () { connection.rawWrite(msg); }, delay);
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

var ContentsVector = function (replySeq, noid, ref) {
	this.container		= new HabBuf();
	this.noids			= [];
	this.objects		= new HabBuf();
	this.containers		= {};
	this.containerRef   = ref;
	this.containerNoid  = noid;
	this.replySeq		= (undefined === replySeq) ? HCode.PHANTOM_REQUEST : replySeq;
	
	this.add = function (o) {
		var mod = o.obj.mods[0];
		if (undefined === this.containerRef) {
			this.containerRef  = o.to;
			this.containerNoid = mod.noid;
			this.containers[this.containerNoid] = this;
		}	
		if (mod.noid !== this.containerNoid) {
			habitatEncodeElkoModState(mod, o.container, this.containers[this.containerNoid].objects);
			this.containers[this.containerNoid].noids.push(mod.noid, HCode.CLASSES[mod.type]);
		} else {
			habitatEncodeElkoModState(mod, o.container, this.containers[this.containerNoid].container);
		}
	};
	this.send = function (client) {		
		var buf = new HabBuf(
				true,
				true,
				this.replySeq,
				HCode.REGION_NOID,
				HCode.MESSAGE_DESCRIBE);
		this.container.data[4] = client.state.avatar.noid;	// TODO Remove this little magic
		buf.add(this.container.data);
		buf.add(this.noids);
		buf.add(0);
		buf.add(this.objects.data);
		buf.add(0);
		buf.send(client, true);
	};
};

function toElko(connection, data) {
	connection.write(data + "\n\n");
}

function initializeClientState(client, who, replySeq) {
	client.sessionName = "" + (++SessionCount);
	client.state = { user: who || "",
			         contentsVector: new ContentsVector(replySeq, HCode.REGION_NOID),
			         objects: [],
			         refToNoid: {},
			         numAvatars: 0,
			         waitingForAvatar: true,
			         replySeq: replySeq
			       };
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
		initializeClientState(client);
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
			client.userRef = confirmOrCreateUser(send.substring(0, colon));				 // Make sure there's one in the NeoHabitat/Elko database.

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
			" request:" + reqNum + " ... " + JSON.stringify(args) + "]");

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

		if (noid === HCode.REGION_NOID && reqNum === HCode.MESSAGE_DESCRIBE) {
			// Transform MESSAGE_DESCRIBE to entering a context. Probably not right. FRF TODO
			var replySeq = (undefined === client.state.nextRegion) ?
									HCode.PHANTOM_REQUEST : client.state.replySeq;
			var changeContextMessage =	{
						to:			"session",	
						op:			"entercontext",
						context:	client.state.nextRegion || Argv.context,
						user:		client.userRef
					};
			Trace.debug("Sending 'entercontext' to " + changeContextMessage.context  +" on behalf of the Habitat client.");
			toElko(server, JSON.stringify(changeContextMessage));
			initializeClientState(client, client.userRef, replySeq);
			return;
			
		} else {
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
					HCode.translate[op].toServer(args, msg);
				}
			}
		}
	}
	if (msg) {
		toElko(server, JSON.stringify(msg));
		Trace.debug(JSON.stringify(msg) + " -> server (" + client.sessionName + ")");
	}
	return;
}

function removeNoidFromClient(client, noid) {
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
			buf.add(state.last_page		|| 1);
			return buf;
		},
		magical: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.magic_type	|| 0);
			return buf;
		},
		massive: function (state, container, buf) {
			buf = this.common(state, container, buf);
//			buf.add(state.mass|| 0);
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
		Region: function (state, container, buf) {
			if (undefined === buf) {
				buf = new HabBuf();
			}
			var bal = state.bankBalance ||  0;
			buf.add(state.terrain_type	||  0);
			buf.add(state.lighting		||  1);
			buf.add(state.depth			|| 32);
			buf.add(state.region_class	||  0);
			buf.add(state.Who_am_I		|| -1);    	
			buf.add((bal & 0xFF000000) >> 6);
			buf.add((bal & 0x00FF0000) >> 4);
			buf.add((bal & 0x0000FF00) >> 2);
			buf.add((bal & 0x000000FF));
			return buf;
		},
		Avatar: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.activity	||   0);
			buf.add(state.action	||   0);			
			buf.add(state.health	|| 255);
			buf.add(state.restrainer||   0);
			buf.add(state.custom	||  [0, 0]);
		},
		Key: function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.key_number_lo	||   0);
			buf.add(state.key_number_hi	||   0);
			return buf;
		},
		Sign:  function (state, container, buf) {
			buf = this.common(state, container, buf);
			buf.add(state.text.getBytes());
			return buf;
		},
		Short_sign:	function (state, container, buf) { return (this.Sign	(state, container, buf)); },
		Plaque:		function (state, container, buf) { return (this.document(state, container, buf)); },
		Head:		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Tree: 		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Wall: 		function (state, container, buf) { return (this.common  (state, container, buf)); },
		Knick_knack:function (state, container, buf) { return (this.magical (state, container, buf)); },
		Rock: 		function (state, container, buf) { return (this.massive (state, container, buf)); },
		Flashlight: function (state, container, buf) { return (this.toggle  (state, container, buf)); },
		Table:		function (state, container, buf) { return (this.openable(state, container, buf)); },
		Box:		function (state, container, buf) { return (this.openable(state, container, buf)); },
		Bag: 		function (state, container, buf) { return (this.openable(state, container, buf)); },
		Ground:		function (state, container, buf) { return (this.walkable(state, container, buf)); },

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
		}
	}

	if (o.op && o.op === "make" && o.you) {	// This connection's avatar has arrived - we have a habitat session!
		var name      = o.obj.name;
		var mod       = o.obj.mods[0];
		var regionRef = o.to.split("-");
		var userRef   = o.obj.ref.split("-");
		UserDB[name] = { regionRef: regionRef[0] + "-" + regionRef[1],
				         userRef:   userRef[0]   + "-" + userRef[1] };
		File.writeFile(UFILENAME, JSON.stringify(UserDB, null, 2));
		client.sessionName += ":" + name;
		client.avatarNoid   = mod.noid;
		if (client.json) { // We might have to tell the server that the avatar is visible - emulating C64 client behavior.
			toElko(server, JSON.stringify({ to:o.to, op:"FINGER_IN_QUE"}));
			toElko(server, JSON.stringify({ to:o.to, op:"I_AM_HERE"}));			
		}
	}


	if (o.type === "changeContext") {
		client.state.nextRegion = o.context;	// Save for MESSAGE_DESCRIBE to deal with later.
		createServerConnection(	client.port, 
								client.host,
								client);				// create a new connection for the new context 
		return true; // Signal this connection to die now that it's obsolete.
	}

	// JSON client is just a relay...
	if (client.json) {
		Trace.debug("server (" + client.sessionName + ") -> "  + JSON.stringify(o) + " -> client (" + client.sessionName + ")");
		toHabitat(client, o);
		return;
	}

	// NEXT UP, TRANSFORM ANY LOGIC

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

	
	if (o.op === "ready") {
		// Eat this, since Elko thinks the region's done and the avatar will arrive later
		// Habitat wants the user's avatar as part of the contents vector.
		return;
	}

	if (o.op === "delete") {
		removeNoidFromClient(client, client.state.refToNoid[o.to]);
		return;
	}
	
	if (o.op === "make") {
		var mod  = o.obj.mods[0];
		var noid = mod.noid || 0;
		o.noid			 = noid;
		o.ref			 = o.obj.ref;
		o.className		 = mod.type;
		o.classNumber	 = HCode.CLASSES[mod.type] || 0;
		if (undefined === HCode[mod.type]) {
			Trace.error("*** Attempted to instantiate class '" + o.className + "' which is not supported. Aborted make. ***");
			return;
		}
		o.clientMessages = HCode[mod.type].clientMessages;
		client.state.objects[noid] = o;
		client.state.refToNoid[o.ref] = noid;
		if (o.className === "Avatar") {
			client.state.numAvatars++;
		}
		if (client.state.waitingForAvatar) {
			if (o.you) {
				client.state.ref    	= o.obj.ref;
				client.state.region 	= o.to;
				client.state.avatar		= mod;				
				for (var i = 0; i < client.state.objects.length; i++) {
					if (undefined !== client.state.objects[i]) {
						client.state.contentsVector.add(client.state.objects[i]);
					}
				}
				Trace.debug(client.state.user + " known as object ref " + client.state.ref + " in region/context " + client.state.region + ".");
				client.state.contentsVector.send(client);
				client.state.contentsVector   =  new ContentsVector(); 		// May be used by HEREIS/makes after region arrival
				client.state.waitingForAvatar = false;
				if (client.state.numAvatars === 1) {
					var caughtUpMessage = new HabBuf(true, true, HCode.PHANTOM_REQUEST, HCode.REGION_NOID, HCode.MESSAGE_CAUGHT_UP);
					caughtUpMessage.add(1);			// TRUE
					caughtUpMessage.send(client);
				}
			}
		} else {
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
		}
		return;
	}

	// End of Special Cases - parse the reply/broadcast/neighbor/private message as a object-command.

	var split = false;
	if (o.type === "reply") {
		var buf = new HabBuf(true, true, client.state.replySeq, o.noid, o.filler);
		if (undefined !== client.state.replyEncoder) {
			split = client.state.replyEncoder(o, buf);
		}
		buf.send(client, split);
		return;
	}
	
	if (undefined !== HCode.SERVER_OPS[o.op]) {
		o.reqno		= HCode.SERVER_OPS[o.op].reqno;
		o.toClient	= HCode.SERVER_OPS[o.op].toClient;
		var buf = new HabBuf(true, true, HCode.PHANTOM_REQUEST, o.noid, o.reqno);
		if (undefined !== o.toClient) {
			split = o.toClient(o, buf);
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

Net.createServer(function(client) {
	// We have a Habitat Client connection!
	client.setEncoding('binary');
	client.state 		= {};
	client.port 		= ElkoPort;
	client.host 		= ElkoHost;
	client.timeLastSent	= new Date().getTime();
	client.lastSentLen	= 0;
	
	Trace.debug('Habitat connection from ' + client.address().address + ':'+ client.address().port);
	createServerConnection(client.port, client.host, client);
	
}).listen(ListenPort, ListenHost);


Trace.info('Habitat to Elko Bridge listening on ' + ListenHost +':'+ ListenPort);
