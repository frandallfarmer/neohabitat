
/** Convert Jmuddle JSON output to Java source.
 *  Also, set the major version id string 
 *  
 *  Randy Farmer 4/29/2017
 */

/** Object for file system */
const	File		= require('fs');
/** Object for trace library - npm install winston */
const Trace		 = require('winston');

const	fileName	= "";
var		table;

const Defaults	= {
		input:	'../../habitat/sources/c64/beta.jlist',
		output:	'../src/main/java/org/made/neohabitat/NeoHabitat.java',
		build:	'PreAlpha',
		trace:  'info'};

/** Object holding command line args - parsed by yargs library: npm install yargs */	
const Argv 		 = require('yargs')
.usage('Usage: $0 [options]')
.option('input',	 { alias: 'i', default: Defaults.input,		describe: '.jlist file (jmuddle generated)'})
.option('output',	 { alias: 'o', default: Defaults.output,	describe: '.java output file'})
.option('build',	 { alias: 'b', default: Defaults.build,		describe: 'String name of this build'})	
.option('trace', 	 { alias: 't', default: Defaults.trace, 	describe: 'Trace level name. (see: npm winston)'})
.option('help',		 { alias: '?', 						     	describe: 'Get this usage/help information.'})
.help('help')
.argv;

function getSizes(subtable, key) {
	key = key || "length";
	var results = [];
	for (var i = 0; i < subtable.length; i++) {
		var x = subtable[i];
		results[x.index] = x[key];
	}
	return results;
}

try {
	data =  File.readFileSync(Argv.input);
	table = JSON.parse(data);
} catch (err) {
	Trace.error(err);
	Trace.error("Unable to read/parse " + fileName);
	process.exit(1);
}

var classLengths	= getSizes(table.Classes);
var imagesLengths	= getSizes(table.Images);
var actionsLengths	= getSizes(table.Actions);
var soundsLengths	= getSizes(table.Sounds);
var headsLengths	= getSizes(table.Heads);
var classResources	= [];

for (var i = 0; i < 256; i++)
	classResources[i] = [[],[],[]];

for (key in table) {
	if (key.startsWith("class_")) {
		var kind = table[key];
		var r = [];
		r[0] = getSizes(kind.images,  "ref index");
		r[1] = getSizes(kind.actions, "ref index");
		r[2] = getSizes(kind.sounds,  "ref index");
		classResources[kind.index] = r;
	}
}

var stream = File.createWriteStream(Argv.output);
stream.once('open', function(fd) {
	stream.write("\npackage org.made.neohabitat;\n\n");
	
	stream.write("import java.util.Date;\n\n");
	
	stream.write("/** This class overwritten by db/make version\n*   it contains data that is (potentially) updated each build,\n*   including the jMuddle output describing the client's resources by class.\n*/\n\n");

	stream.write("public class NeoHabitat {\n\n")

	stream.write("    public static final String BUILD_NAME	   = " + JSON.stringify(Argv.build) + ";\n\n");
	stream.write("    public static final int    RESOURCE_IMAGE  = 0;\n");
	stream.write("    public static final int    RESOURCE_ACTION = 1;\n");
	stream.write("    public static final int    RESOURCE_SOUND  = 2;\n");
	stream.write("    public static final int    RESOURCE_HEAD   = 3;\n\n");
	stream.write("    public static final int[] ClassSizes = " + JSON.stringify(classLengths).replace('[','{').replace(']','}') + ";\n\n");
	stream.write("    public static final int[][] ResourceSizes = {" + JSON.stringify(imagesLengths).replace('[','{').replace(']','}')	+ ",    // Images\n");
	stream.write("                                                 " + JSON.stringify(actionsLengths).replace('[','{').replace(']','}')	+ ",    // Actions\n");
	stream.write("                                                 " + JSON.stringify(soundsLengths).replace('[','{').replace(']','}')	+ ",	// Sounds\n");
	stream.write("                                                 " + JSON.stringify(headsLengths).replace('[','{').replace(']','}') 	+ "};   // Heads\n\n");
	stream.write("    public static final int[][][] ClassResources = " + JSON.stringify(classResources).replace(/\[/g,'{').replace(/\]/g,'}') + ";\n\n");
	
	stream.write("    public static String GetBuildVersion() {\n");
	stream.write("        return String.format(BUILD_NAME + \":%tc\",  new Date(" + (new Date()).getTime() + "l));\n");
	stream.write("    }\n\n");

	stream.write("}\n");
	stream.end();
});



