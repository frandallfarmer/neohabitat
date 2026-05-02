// Populates pre-made Habitat Elko objects into MongoDB.

// Usage: node populateModels.js MONGO_HOST FILE_ROOT
// Examples:
//   node populateModels.js 127.0.0.1:27017 all

const cliProgress = require('cli-progress');
const dree = require('dree');
const fs = require('fs').promises;
const MongoClient = require('mongodb').MongoClient;
const process = require('process');

// Number of upsert operations per bulkWrite request. The mongo driver
// will internally split larger batches, but capping here keeps memory
// pressure predictable on large schema loads.
const BULK_BATCH_SIZE = 1000;

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

// Per-batch bulk upsert. `ordered: false` lets the driver parallelize
// within the batch and continue on per-op errors instead of aborting
// the whole batch on the first failure.
async function bulkUpsert(db, batch) {
  const ops = batch.map((obj) => ({
    replaceOne: {
      filter: { ref: obj.ref },
      replacement: obj,
      upsert: true,
    },
  }));
  await db.collection('odb').bulkWrite(ops, { ordered: false });
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
  try {
    // try parsing the string - if it's already valid JSON, there's no need to run the preprocessing logic
    JSON.parse(data)
    return data
  } catch (e) {
    let templated = templateConstantJoins(data);
    for (let replacementId in replacements) {
      let replacement = replacements[replacementId];
      let regex = replacement[0];
      let replacementText = replacement[1];
      templated = templated.replace(regex, replacementText);
    }
    return templateStringJoins(templated);
  }
}

// Bulk-write `objects` to db.odb. Index on `ref` is created up front so
// the per-op upsert lookup is O(log n) instead of O(n) — without it, the
// later batches scan an ever-growing collection.
const runAllUpdates = async (db, objects) => {
  if (objects.length === 0) {
    console.log('No Habitat objects to write.');
    return;
  }
  console.log('Writing', objects.length, 'Habitat objects in batches of', BULK_BATCH_SIZE);

  await db.collection('odb').createIndex({ ref: 1 });

  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  progressBar.start(100, 0);

  let done = 0;
  for (let i = 0; i < objects.length; i += BULK_BATCH_SIZE) {
    const batch = objects.slice(i, i + BULK_BATCH_SIZE);
    await bulkUpsert(db, batch);
    done += batch.length;
    progressBar.update(Math.round(done / objects.length * 100));
  }
  progressBar.stop();
  console.info('Updated', objects.length, 'Habitat objects');
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

  // Two-phase: collect every habitat object into memory first, then
  // bulk-write. Decouples the file-scan from mongo I/O so we can index
  // and batch optimally.
  const objects = [];

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
      templatedJSON = templateHabitatObject(data);
      const parsed = JSON.parse(templatedJSON);
      const items = parsed instanceof Array ? parsed : [parsed];
      for (const obj of items) {
        lookForTeleportEntries(obj);
        objects.push(obj);
      }
    } catch (e) {
      console.error('Failed to parse file:', path);
      console.error(templatedJSON);
      console.error(e);
    }
  };

  await dree.scanAsync(fileRoots[fileRootName], {
    extensions: [ 'json' ],
    // Don't descend into node_modules — every nested package.json and
    // locale file would be visited just to be skipped, which scales
    // linearly with installed deps and adds minutes to schema build.
    exclude: /node_modules/,
  }, updateFn);

  await runAllUpdates(db, objects);

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
