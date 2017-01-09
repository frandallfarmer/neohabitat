/**
 * Telko: A brain-dead simple telnet-style relay meant to be used for
 * testing Elko servers with simple text JSON messages, usually pasted
 * in from a text file.
 * 
 * The problem is that some references change between executions, so 
 * statically stored (text file) JSON messages can't work
 * to refer to objects that are Elko 'clone's or users.
 * 
 * This file fixes that by allowing partial unique identifiers in the
 * "to:" field and attempts to promote them to fully qualified refs.
 * 
 * Any message may include a "Telko" object which allows the input 
 * to customize the session - current editable variables include:
 * Telko.logtime (boolean) which includes a timestamp in the log
 * Telko.delay (number) seconds to delay before the next message
 * is sent (useful only when redirecting STDIN from a file.)
 * 
 * Author: Randy Farmer 12/22/2016 
 */

/* jslint bitwise: true */
/* jshint esversion: 6 */

/** Object for net library */
const Net		 = require('net');
/** Object for the readline library */
const Readline	 = require('readline');
/** Object for file system */
const File       = require('fs');
/** Object for trace library - npm install winston */
const Trace		 = require('winston');

const DefDefs	= {context: 'context-test',
				   end: 	'quit',
				   delay:	1000,
				   logtime: true,
				   host: 	'127.0.0.1',
				   port: 	1337,
		           trace:	'info'};
var	  Defaults	= DefDefs;

try {
	var userDefs = JSON.parse(File.readFileSync("defaults.elko"));
	Defaults = { context:	userDefs.context	|| DefDefs.context,
			     end: 		userDefs.end		|| DefDefs.end,
			     delay:		userDefs.delay		|| DefDefs.delay,
			     logtime:	userDefs.logtime	|| DefDefs.logtime,
			     host:		userDefs.host		|| DefDefs.host,
			     port:		userDefs.port		|| DefDefs.port,
			     trace:		userDefs.trace		|| DefDefs.trace
	};
	if (undefined === userDefs.host && undefined === userDefs.port && undefined !== userDefs.listen) {
		var spec = userDefs.listen.split(':');
		Defaults.host = spec[0];
		Defaults.port = spec[1];
	}
} catch (e) {
	Trace.warn("Missing defaults.elko configuration file. Proceeding with factory defaults.");
}

/** Object holding command line args - parsed by yargs library: npm install yargs */	
const Argv 		 = require('yargs')
		.usage('Usage: $0 [options]')
		.example('$0', 
				"Connect to default Elko server in interactive (standard input) mode (paste/type json blocks) or type <[SCRIPT] to read lines from an [.elko] file.\n")								
		.example('$0 --files=start,more --end=stdin --trace=debug', 
				"Connect to the default Elko server in 'debug' trace mode and send the contents of start[.elko], more[.elko] and then stdin[.elko] [keeps connection open, enters interactive mode]\n")
		.example('$0 -f start', 
				"Connect to default Elko server, execute start[.elko] then the default termination file, quit[.elko] which disconnects from the server.\n")
		.help('help')
		.option('help',		 { alias: '?', 						     	describe: 'Get this usage/help information.'})
		.option('trace', 	 { alias: 't', default: Defaults.trace, 	describe: 'Trace level name. (see: npm winston)'})
		.option('context',   { alias: 'c', default: Defaults.context,	describe: 'Parameter for entercontext if left unspecified.'})
		.option('host',		 { alias: 'h', default: Defaults.host,		describe: 'Host name or address of the Elko server.'})
		.option('port',		 { alias: 'p', default: Defaults.port,		describe: 'Port number for the Elko server.'})
		.option('files', 	 { alias: 'f', 						    	describe: 'Send a comma seperated list of Elko scripts [.elko optional] to server. If unspecified, run in interactive (STDIN) mode.'})
		.option('end', 		 { alias: 'e', default: Defaults.end,		describe: 'Ending script [.elko optional] to run after all the -f files have been transmitted.'})
		.option('delay',	 { alias: 'd', default: Defaults.delay,		describe: 'Time between packet sends in milliseconds. Usually overridden in scripts.'})
		.option('logtime',	 { alias: 'l', default: Defaults.logtime,	describe: 'Add timestamp to log?'})
		.argv;

Trace.level 	 = Argv.trace;

/** Now many time tics per second */
const Millis	 = 1000;
/** Telko allows a parameter to delay the time between outgoing events (a crude simulation of a slow client: timeLastSent tracks events to be scheduled in the future even though they arrive on stdin instantly. */
var	  timeLastSent = new Date().getTime();

/** Configuration variables, overridden by JSON object read from either the command line or the input stream. */
var Telko = {
		"host":		 Argv.host,
		"port":		 Argv.port,
		"delay":	 Argv.delay,
		"context":	 Argv.context,
		"end":		 Argv.end,
		"logtime":	 Argv.logtime
};

/** Short names for all of the objects seen and the most recent fully qualified ref for that object. */
var Names = {};

/** An instance of all the objects seen during this session. Used for embedded variable substitution */
var History = {};

function pad0(n,z) {
	z = z || 1;
	return ("000" + n).slice(-(z + 1));
}
/**
 * Returns a string to prefix log entries with. Uses Telko.logtime as a flag to return the result with, or wihout a timestamp.
 * 
 * @param String ptr The "pointer" string - put after the timestamp or at the head of the line depending on Telko.logtime
 * @returns String The header for the log line...
 */
function timestamp(ptr) {
	if (!Telko.logtime) { return ptr + " "; }
	var time = new Date();
	return	time.getFullYear()				+ "/" +
			pad0(time.getMonth() + 1)		+ "/" +
			pad0(time.getDate())			+ " " +		   
			pad0(time.getHours())			+ ":" +
			pad0(time.getMinutes())			+ ":" +
			pad0(time.getSeconds())			+ "." +
			pad0(time.getMilliseconds(), 3)	+ " " +
			ptr + " ";
}

/**
 * A very aggressive name mapper. Splits on dashes '-' and dots '.'
 * 
 * @param String s The label to split up and attach to the names table
 */

function addName(s) {
	s.split("-").forEach(function(dash) {
		Names[dash] = s;
		dash.split(".").forEach(function(dot) {
			Names[dot] = s;
		});
	});
}



/**
 * JSON parse the message, handling errors.
 * 
 * @param String s
 * @returns Object The JSON object from the message or {}
 */
function parseElko(s) {
	var o = {};
	try {
		o = JSON.parse(s);
	} catch (e) {
		Trace.warn("Unable to parse: " + s + "\n\n" + JSON.stringify(e, null, 2));
	}
	return o;
}

/**
 * 
 * @param String s The message to be scanned for references ('ref's)
 */
function scanForRefs(s) {
	var o = parseElko(s);
	if (o.to) {
		addName(o.to);
	}
	if (o.op && o.op === "make") {
		var ref = o.obj.ref;
		addName(ref);
		History[ref] = o;
		if (o.you) {
			var split	= ref.split("-");
			Names.ME 	= ref;
			Names.USER	= split[0] + "-" + split[1];
		}
	}	
}

/**
 * This allows the input (stdin/file) to use short-names for addressing objects. "randy" instead of "user-randy-13491283092"
 * 
 * @param String s
 * @returns Either s or the value of Name[s], if it exists.
 */
function substituteName(s) {
	return Names[s] || s;
}

/**
 * Telko supports a special state substitution. Any string that starts with "$" will trigger a lookup of the 
 * state via the Names table. Example "$randy.obj.mod[0].x" will lookup "randy"'s formal ref in the $Names
 * table, then the value of History.user-randy-1230958410291.obj.mod[0].x will be substituted. All substitutions will
 * occur in place.
 * 
 * @param JSON Object m The object/message that will have it's parameters ($) substituted.
 */
function substituteState(m) {
	for (var name in m) {
		if(m.hasOwnProperty(name)) {
			var prop = m[name];
			if ((typeof prop === 'string' || prop instanceof String) && prop.indexOf('$') !== -1) {
				var chunks = prop.split("$");
				for (var i = 1; i < chunks.length; i++) {
					var value  = chunks[i];
					var keys   = chunks[i].split('.');
					var first  = true;
					var obj;
					var mod;
					for(var j = 0; j < keys.length; j++) {
						var varseg = keys[j];
						if (first) {
							value = History[substituteName(varseg)];
							if (undefined === value) {	// No matching object, so substitute the key's value
								value = Names[varseg] || chunks[i];
								break;
							}
							if (undefined !== value.obj) {
								obj = value.obj;
								if (undefined !== obj.mods & obj.mods.length === 1) {
									mod = obj.mods[0];
								}
							}
							first = false;
						} else {
							value = (undefined !== mod && undefined !== mod[varseg]) ? mod[varseg] :
								(undefined !== obj && undefined !== obj[varseg]) ? obj[varseg] :
									value[varseg];
						}
					}
					chunks[i] = value;
				}
				if (chunks.length === 2 && chunks[0] === "") {
					m[name] = chunks[1];		// This preserves integer types, which have no leading chars
				} else {
					m[name] = chunks.join("");	// For in-string substitutions. 
				}
			}
		}
	}
}


/**
 * This is the server object created with Net.connect. 
 */
const Server = Net.connect(Telko.port, Telko.host, function() {
	Trace.info("Server connected @" + Server.address().address + ':'+ Server.address().port);
});

/** 
 * All we want to do with incoming packets is log them and register any incoming references for later lookup.
 * 
 * @param String s The packed coming in from the server.
 * @returns
 */
function processElkoPacket(s) {
	console.log(timestamp("<-") + s.trim());
	scanForRefs(s);
}

/**
 * Server.on deals with incoming data from the Server. We need to use Elko packet framing,
 * inherited from HTML days - so as we find the end of each server packet, we process it.
 */
Server.on('data', function(buf) {
	var framed = false;
	var firstEOL = false;
	var JSONFrame = "";
	var blob = buf.toString();
	for (var i=0; i < blob.length; i++) {
		var c = blob.charCodeAt(i);
		if (framed) {
			JSONFrame += String.fromCharCode(c);
			if (10 === c) {
				if (!firstEOL) {
					firstEOL = true;
				} else {
					processElkoPacket(JSONFrame);
					framed    = false;
					firstEOL  = false;
					JSONFrame = "";
				}
			}
		} else {
			if (123 === c) {
				framed = true;
				firstEOL = false;
				JSONFrame = "{";
			} else {
				if (10 !== c) {
					Trace.debug("IGNORED: " + c);					
				}
			}
		}
	}
	if (framed) {	
		processElkoPacket(JSONFrame);
		framed    = false;
		firstEOL  = false;
		JSONFrame = "";
	}
});

/**
 * Server.on: What if the Elko Server breaks the connection? For now we tear the bridge down also.
 * If we ever bring up a "director" based service, this will need to change on context changes.
 */
Server.on('end', function() {
	Trace.info('Server disconnected...');
	process.exit(0);
});

/**
 * Make last minute substitutions, and send a string version of the object to the server.
 * 
 * @param JSONObject obj The JSON Object/Message to send after substitution. 
 */
function sendWithSubstituions(obj) {
	if (obj.to) {
		obj.to = substituteName(obj.to);
	}
	substituteState(obj);
	if (undefined !== obj.op && "entercontext" === obj.op && undefined === obj.context) {
		obj.context = Telko.context;
	}
	var msg = JSON.stringify(obj);
	console.log(timestamp("->") + msg.trim());
	Server.write(msg);
}

function startReadingSTDIN() {
	Readline.createInterface({input: process.stdin}).on('line', (input) => { handleInputLine(input); });
}

function handleInputLine(input) {
	if (input.indexOf("{") === 0) {
		var obj = parseElko(input.toString());
		// Send the message, potentially in the future...
		var now  = new Date().getTime();
		var when = timeLastSent + Telko.delay;

		// Any message may contain features the reconfigure it.
		if (obj.Telko) {
			Telko.delay = ( obj.Telko.delay || Telko.delay / Millis) * Millis;	// Effects NEXT message, not this one.
			Telko.logtime = (undefined !== obj.Telko.logtime) ? obj.Telko.logtime : Telko.logtime;
			// No support for changing servers at the moment...
			if (obj.Telko.host || obj.Telko.port) {
				Trace.error("No support for changing servers at the moment...");
			}
			delete obj.Telko;
		}
		
		if (when <= now) {
			sendWithSubstituions(obj);
			timeLastSent = now;
		} else {
			var delay = Math.max(0, (when - now));
			setTimeout(function () { sendWithSubstituions(obj); }, delay);
			timeLastSent = when;
		}
	} else if (input.indexOf("<") === 0) {
		var file = input.trim().slice(1);
		if ("STDIN" === file) {
			// Read from STDIN (usually triggered in a script, so that the timing works out...)
			startReadingSTDIN();
		} else {
			// Run a telko script file!
			executeScript(file);
		}
	}
}

function executeScript(script) {
	var contents;
	try {
		contents = File.readFileSync(script);
	} catch (err) {
		try {
			contents = File.readFileSync(script + ".elko");
		} catch (err) {
			Trace.error("Unable to read " + script + "[.elko]");
		}
	}
	if (contents) {
		var lines = contents.toString().split('\n');
		for (var i = 0; i < lines.length; i++) {
			handleInputLine(lines[i]);
		}
	}
}

/** 
 * Telko will take its input from either STDIN or as a list of script files using the command line paramter --files=FILE1,FILE2,...
 */
if (Argv.files) {
	var files = Argv.files.split(',');
	for (var i = 0; i < files.length; i++) {
		executeScript(files[i]);
	}
	executeScript(Telko.end);
} else {
	startReadingSTDIN();
}
