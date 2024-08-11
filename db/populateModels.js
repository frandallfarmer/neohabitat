// Populates pre-made Habitat Elko objects into MongoDB.

// Usage: node populateModels.js MONGO_HOST FILE_ROOT
// Examples:
//   node populateModels.js 127.0.0.1:27017 all

const backoff = require('exponential-backoff').backOff;
const cliProgress = require('cli-progress');
const dree = require('dree');
const fs = require('fs').promises;
const MongoClient = require('mongodb').MongoClient;
const process = require('process');

const fileRoots = {
  all: '.',
  book_of_records: './Text/text-bookofrecords.json',
  downtown_regions: './new_Downtown',
  woods: './Woods',
  beach: './Beach',
  hell:  './Hell',
  back4t: './Back4t',
  streets: "./Streets",
  text: './Text',
  users: './Users'
};

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

// Adapted from mongohelper.js:
let teleportDirectory = { 
  ref: "teleports", 
  type: "map",
  map: {}
};

function squish(s) {
  return s.toLowerCase().replace(/\s/g,'');
}

function lookForAliases(o, target) {
  if (o.aliases) {
    foundTeleports = true;
    for (let i = 0; i < o.aliases.length; i++) {
      teleportDirectory.map[squish(o.aliases[i])] = target;
    }
  } 
}

function lookForTeleportEntries(o) {
  if (o.type && (o.type == 'item' || o.type == 'context')) {
    const mod = o.mods[0];
    if (mod.type === "Teleport") {
      foundTeleports = true;
      teleportDirectory.map[squish(mod.address)] = o.in;
      lookForAliases(mod, o.in);
    } else if (mod.type === "Elevator") {
      foundTeleports = true;
      teleportDirectory.map[squish(`otis-${mod.address}`)] = o.in;
    }
    if (o.type === "context") {
      lookForAliases(o, o.ref);
      lookForAliases(mod, o.ref);
    }
  }
}

async function eupdateOne(db, obj) {
  lookForTeleportEntries(obj);
  await db.collection('odb').findOneAndUpdate(
    { ref: obj.ref },
    { $set: obj },
    { upsert: true },
  );
}

async function eupdateArray(db, array) {
  if (array.length == 0) {
    return;
  }
  const localArray = array.slice();
  const curObj = localArray.shift();
  lookForTeleportEntries(curObj);
  await db.collection('odb').findOneAndUpdate(
    { ref: curObj.ref },
    { $set: curObj },
    { upsert: true },
  );
  await eupdateArray(db, localArray);
}

function templateStringJoins(data) {
  if (data.search(/\+/) != -1) {
    return data.replace(/(\n)/g, '').replace(stringJoinRegex,
      function(origText) {
        let replacementText = [];
        let splitText = origText.split('+');
        for (let textLineId in splitText) {
          let trimTextLine = splitText[textLineId].trim();
          let quotesRemoved = trimTextLine.replace(/(^")|("$)/g, '');
          replacementText.push(quotesRemoved);
        }
        return `"${replacementText.join('')}"`;
      }
    );
  }
  return data;
}

function templateConstantJoins(data) {
  return data.replace(replacementJoinRegex, function(origText) {
    let replacementText = [];
    let splitText = origText.split('+');
    for (let habConstId in splitText) {
      let trimHabConst = splitText[habConstId].trim();
      if (trimHabConst in joinReplacements) {
        replacementText.push(joinReplacements[trimHabConst]);
      }
    }
    return `"${replacementText.join('')}"`;
  });
}

function templateHabitatObject(data) {
  let templated = templateConstantJoins(data);
  for (let replacementId in replacements) {
    let replacement = replacements[replacementId];
    let regex = replacement[0];
    let replacementText = replacement[1];
    templated = templated.replace(regex, replacementText);
  }
  return templateStringJoins(templated);
}

const runAllUpdates = async (promisesArray) => {
  console.log('Waiting for in-flight Habitat object updates:', promisesArray.length);
  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  let doneCount = 0;
  const overallCount = promisesArray.length;
 
  const handleProgress = (result) => {
    doneCount++;
    progressBar.update(Math.round(doneCount / overallCount * 100));
    return result;
  };
 
  const handleComplete = (results) => {
    console.info('Updated', results.length, 'Habitat objects');
    progressBar.stop();
  }
  
  progressBar.start(100, 0);
  await Promise.all(promisesArray.map(p => p.then(handleProgress)))
    .then((results) => {
      handleComplete(results);
    });
}

const populateModels = async () => {
  if (process.argv.length < 4) {
    console.error('Populates pre-made Habitat Elko objects into MongoDB.');
    console.error('Usage: node populateModels.js MONGO_HOST FILE_ROOT');
    process.exit(-1);
  }

  let mongoHost = process.argv[2];
  let fileRootName = process.argv[3];

  if (!(fileRootName in fileRoots)) {
    fileRoots["custom"] = fileRootName;
    fileRootName = "custom";
  }

  const client = await MongoClient.connect(`mongodb://${mongoHost}/`, {
    connectTimeoutMS: 15000
  });
  let db = client.db('elko');

  let updates = [];

  const updateFn = async ({name, path}) => {
    if (path.includes("node_modules") ||
        name.startsWith("package.json") ||
        name.startsWith("package-lock.json")) {
      console.info('Skipping non-Habitat JSON:', path)
      return;
    }
    let templatedJSON = '';
    try {
      const data = await fs.readFile(path, 'utf8');
      // Templates and attempts to parse the object's JSON.
      templatedJSON = templateHabitatObject(data);
      let habitatObject = JSON.parse(templatedJSON);
      if (habitatObject instanceof Array) {
        updates.push(backoff(() => eupdateArray(db, habitatObject)));
      } else {
        updates.push(backoff(() => eupdateOne(db, habitatObject)));
      }
    } catch (e) {
      console.error('Failed to parse file:', path);
      console.error(templatedJSON);
      console.error(e);
    }
  };

  await dree.scanAsync(fileRoots[fileRootName], {
    extensions: [ 'json' ]
  }, updateFn);
  
  await runAllUpdates(updates);

  if (Object.keys(teleportDirectory.map).length > 0) {
    teleportDirectory.map[' End of Directory'] = 'eod';
    console.log('Writing teleport directory:', JSON.stringify(teleportDirectory));
    await db.collection('odb').insertOne(teleportDirectory);
  }

  await client.close();
  console.log('Successfully populated', fileRootName, 'models!');
}

// Starts the model population process on main().
(async function main() {
  await populateModels();
}());
