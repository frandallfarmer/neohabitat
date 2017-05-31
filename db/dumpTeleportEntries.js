const replacements = [
  [/UP/g, '"|"'],
  [/DOWN/g, '"}"'],
  [/LEFT/g, '"~"'],
  [/RIGHT/g, '"\u007f"'],
  [/SPACE/g, '" "'],
  [/WEST/g, '0'],
  [/SOUTH/g, '1'],
  [/EAST/g, '2'],
  [/NORTH/g, '3']
];

const joinReplacements = {
  UP: '|',
  DOWN: '}',
  LEFT: '~',
  RIGHT: '\u007f',
  SPACE: ' ',
  WEST: '0',
  SOUTH: '1',
  EAST: '2',
  NORTH: '3'
};

const replacementJoinRegex = /((([A-Z]+\s?\+\s?)+)([A-Z]+\s?)+)/;
const stringJoinRegex = /(("([^"]|\\")*"\s*\+\s*)+"([^"]|\\")*")/g;

function templateStringJoins(data) {
  if (data.search(/\+/) != -1) {
    return data.replace(/(\n)/g, '').replace(stringJoinRegex,
      function(origText, offset, string) {
        var replacementText = [];
        var splitText = origText.split('+');
        for (var textLineId in splitText) {
          var trimTextLine = splitText[textLineId].trim();
          var quotesRemoved = trimTextLine.replace(/(^")|("$)/g, '');
          replacementText.push(quotesRemoved);
        }
        return '"{0}"'.format(replacementText.join(''));
      }
    );
  }
  return data;
}

function templateConstantJoins(data) {
  return data.replace(replacementJoinRegex, function(origText, offset, string) {
    var replacementText = [];
    var splitText = origText.split('+');
    for (var habConstId in splitText) {
      var trimHabConst = splitText[habConstId].trim();
      if (trimHabConst in joinReplacements) {
        replacementText.push(joinReplacements[trimHabConst]);
      }
    }
    return '"{0}"'.format(replacementText.join(''));
  });
}

function templateHabitatObject(data) {
  var templated = templateConstantJoins(data);
  for (var replacementId in replacements) {
    var replacement = replacements[replacementId];
    var regex = replacement[0];
    var replacementText = replacement[1];
    templated = templated.replace(regex, replacementText);
  }
  return templateStringJoins(templated);
}

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
			objects = JSON.parse(templateHabitatObject(jsonSource));
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
