
/** dump teleport entries found in a json object from STDIN */

var jsonSource = '';


var squish = function (s) {
	return s.toLowerCase().replace(/\s/g,'');
}

var lookForAliases = function (o, target) {
	if (o.aliases) {
		for (var i = 0; i < o.aliases.length; i++) {
			console.log("\"" + squish(o.aliases[i])+ "\":\"" + target + "\",");
		}
	}	
}

var lookForTeleportEntries = function (o) {
	if (o.type && (o.type == "item" || o.type == "context")) {
		var mod = o.mods[0];
		if (mod.type === "Teleport") {
			console.log("\"" + squish(mod.address) + "\":\"" + o.in + "\",");
			lookForAliases(mod, o.in);
		} else if (mod.type === "Elevator") {
			console.log("\"" + "otis-" + squish(mod.address) + "\":\"" + o.in + "\",");
		}
		if (o.type === "context") {
			lookForAliases(o, o.ref);
			lookForAliases(mod, o.ref);
		}
	}
}

process.stdin.resume();

process.stdin.on('data', function(buf) { jsonSource += buf.toString(); });

process.stdin.on('end', function() {
	var objects;
	if ( jsonSource.length && (jsonSource.indexOf("\"aliases\"") > -1 || jsonSource.indexOf("\"address\"") > -1)) {
		try {
			objects = JSON.parse(jsonSource);
		} catch (err) {
			console.error("JSON parsing failed.\n" + err.stack + "\n" + jsonSource);
			process.exit(1);
		}
		if (Array.isArray(objects))  {
			for (var i = 0; i < objects.length; i++) {
				lookForTeleportEntries(objects[i]);
			}	
		} else {
			lookForTeleportEntries(objects);
		}
	}
});





