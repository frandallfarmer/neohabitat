/** Directory Handler */
const DirectoryTree = require('directory-tree');
/** Object for file system */
const File       = require('fs').promises;
/** Object for trace library - npm install winston */
const Trace      = require('winston');

const Argv       = require('yargs')
        .usage('Usage: node $0 --files=json,file,list [options]')
        .example('node $0 --files=Text/text-popmap.json',
           "Translate Habitat Text Documents to HTML documents at the same path.\n\nNOTE: HTML output will be the SAME PATH with .html appended.\n")                   
        .help('help')
        .option('help',      { alias: '?',                   describe: 'Get this usage/help information.'})
        .option('name',      { alias: 'n',                   describe: 'Set the name (aka <title>) of the web page, defaults to first line of document.'})
        .option('trace',     { alias: 't', default: "debug", describe: 'Trace level name. (see: npm winston)'})
        .option('files',     { alias: 'f',                   describe: 'List of .json-ish Habitat Text files, comma delimited.'})
        .option('directory', { alias: 'd',                   describe: 'Path to a directory containing .json files to convert to html. Also creates HabitatDocuments.html index in the current directory.'})
        .argv;

Trace.level      = Argv.trace;

var Translate = []

for (let character = 0; character < 128; character++) {
  if (character < 32) { Translate[character] = "&#" + (character+192) + ";"; }
  else { Translate[character]= String.fromCharCode(character)};  
}

//Translate[9]  = "&#17;";
//Translate[10] = "&#18;";
//Translate[13] = "&#17;";

const stringJoinRegex = /(("([^"]|\\")*"\s*\+\s*)+"([^"]|\\")*")/g;

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

var Output = ""
var Titles = ""     

function writeHtmlBlock(block) {
  Output += block + "\n";
}


function htmlHeader(title) {
  writeHtmlBlock('<html>\n<!-- This file was auto-generated. "make pages" from /db to regenerate everything -->');
  writeHtmlBlock('<title>' + (Argv.name || title) + '</title>');
  writeHtmlBlock('<link rel="stylesheet" href="charset/charset.css" type="text/css" charset="utf-8"/>');
  writeHtmlBlock('<body>');
}

function writeHabidocPage(html) {
  writeHtmlBlock('<pre>');
  writeHtmlBlock(html);
  writeHtmlBlock("</pre>");
}

function htmlFooter(outfile) {
  writeHtmlBlock('</body></html>');
  File.writeFile(outfile, Output, err => {
    if (err) {
      console.error(err);
    }
  });
}

const Habitat2HTML = async (infile) => {
  const outfile = infile + ".html";
  const jsonish = await File.readFile(infile, 'utf8');
  var document = JSON.parse(templateStringJoins(jsonish));
  var html = "";
  var title = Argv.name || document.title || document.ref;
  var writeHeader = true;
  if (document.pages) {
    for (const page of document.pages) {
      let html = "";
      for (let pos = 0, len = page.length; pos < len ; pos++) {
        html += Translate[page.charCodeAt(pos)];
        if (((pos + 1) % 40) == 0) { html += "\n" }
      }
      if (writeHeader) { htmlHeader(title); writeHeader = false; }
      writeHabidocPage(html);
    }
  } else {
    var page = new Array();
    page = document.ascii[0];
    for (let pos = 0, len = page.length; pos < len ; pos++) {
      html += Translate[page[pos]];
      if (((pos + 1) % 40) == 0) { html += "\n" }
    }
    htmlHeader(title);
    writeHabidocPage(html);
  }
  htmlFooter(outfile);
  Titles += "<tr><td><a href='" + outfile + "'>"+ title +"</a><td><tr>\n";
  writeIndex(Titles);
  Output = "";
}


function writeIndex(titles) {
  Output = "<html><body><h1>Habitat In-World Documents</h1>\n<table>";
  Output += titles;
  Output += "</body></html>\n";
  File.writeFile("HabitatDocuments.html", Output, err => {
    if (err) {
      console.error(err);
    }
  });
  Output = "";
}

function convertFiles (files) {
  for (const element of files) { Habitat2HTML(element.path); };
};

(async function main() {

  if (Argv.files) {
    var files = Argv.files.split(',');
    for (var i = 0; i < files.length; i++) {
        await Habitat2HTML(files[i]);
    }
  } else if (Argv.directory) {
      convertFiles(DirectoryTree(Argv.directory, { extensions: /\.json/ }).children);
  } else {
    console.log("No files specified, nothing done. See --help");
  }
}());

