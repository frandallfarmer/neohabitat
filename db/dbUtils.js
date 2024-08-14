const	MongoClient	= require('mongodb').MongoClient;
const process = require('process');


const databaseExists = async (client, dbName) => {
  const databases = await client.db().admin().listDatabases();
  console.log(databases);
  if (databases.databases.some(({name}) => name === dbName)) {
    console.info(` - Detected '${dbName}' Mongo database`)
    return 0;
  }
  console.info(` - Did not detect '${dbName}' Mongo database`)
  return -1;
};

const nukeDatabase = async (client) => {
  const odb = await databaseExists(client, 'elko');
  if (odb === -1) {
    console.info(" - 'elko' database does not exist, no need to nuke")
    process.exit(0);
  }
  await client.db('elko').dropDatabase();
}

const runDBTests = async () => {
  if (process.argv.length < 4) {
    console.error("Administers Neohabitat's local MongoDB database.");
    console.error('Usage: npm run dbUtils -- MONGO_HOST MODE');
    console.error('Modes:');
    console.error(' - nuke: nukes the database');
    console.error(' - testElko: tests if the elko database is present, returns status code 0 if so');
    process.exit(-1);
  }

  var mongoHost = process.argv[2];
  var mode = process.argv[3];

  const client = await MongoClient.connect(`mongodb://${mongoHost}/`, {
    connectTimeoutMS: 15000
  });
  switch (mode) {
    case "nuke":
      await nukeDatabase(client);
    case "testElko":
      const exitValue = await databaseExists(client, 'elko');
      process.exit(exitValue);
    default:
      console.error('Unknown mode:', mode);
      process.exit(-1);
  }
};

(async function main() {
  await runDBTests();
}());