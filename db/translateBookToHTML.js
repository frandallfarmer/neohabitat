/** Object for file system */
const File       = require('fs').promises;
/** Object for trace library - npm install winston */
const Trace      = require('winston');

const Argv       = require('yargs')
        .usage('Usage: node $0 --files=json,file,list [options]')
        .example('node $0 --files=Text/text-popmap.json', "Translate Habitat Text Documents to HTML documents at the same path.\n")                   
        .help('help')
        .option('help',      { alias: '?',                   describe: 'Get this usage/help information.'})
        .option('name',      { alias: 'n',                   describe: 'Set the name (aka title) of the web page, defaults to first line of document.'})
        .option('trace',     { alias: 't', default: "debug", describe: 'Trace level name. (see: npm winston)'})
        .option('files',     { alias: 'f',                   describe: 'List of .json-ish Habitat Text files, comma delimited.'})
        .argv;

Trace.level      = Argv.trace;

var Translate = []

for (let character = 0; character < 128; character++) {
  if (character < 32) { Translate[character] = "&#" + character + ";"; }
  else { Translate[character]= String.fromCharCode(character)};  
}

Translate[9]  = "&#17;";
Translate[10] = "&#18;";
Translate[13] = "&#17;";

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

function writeHtmlBlock(block) {
  console.log(block);
}

function htmlHeader(title) {
  writeHtmlBlock('<html>');
  writeHtmlBlock('<title>' + (Argv.name || title) + '</title>');
  writeHtmlBlock('<body style="font-family:charset;font-size:24;">');
  writeHtmlBlock('<link rel="stylesheet" href="https://frandallfarmer.github.io/neohabitat-doc/docs/charset/charset.css" type="text/css" charset="utf-8"/>');
}

function writeHabidocPage(html) {
  writeHtmlBlock('<pre style="font-family:charset;font-size:24;word-wrap:break-word;width:40ch;line-height:71%;color:black;background-color:coral;border-style:solid;padding:10px;">');
  writeHtmlBlock(html);
  writeHtmlBlock("</pre>");
}

function htmlFooter() {
  writeHtmlBlock('</body></html>');
}

const Habitat2HTML = async (infile) => {
  const jsonish = await File.readFile(infile, 'utf8');
  var document = JSON.parse(templateStringJoins(jsonish));
  var html = "";
  var writeHeader = true;
  if (document.pages) {
    for (const page of document.pages) {
      let html = "";
      for (let pos = 0, len = page.length; pos < len ; pos++) {
        html += Translate[page.charCodeAt(pos)];
        if (((pos + 1) % 40) == 0) { html += "\n" }
      }
      if (writeHeader) { htmlHeader(html.substring(0,40)); writeHeader = false;}
      writeHabidocPage(html);
    }
  } else {
    var page = new Array();
    page = document.ascii[0];
    for (let pos = 0, len = page.length; pos < len ; pos++) {
      html += Translate[page[pos]];
      if (((pos + 1) % 40) == 0) { html += "\n" }
    }
    htmlHeader(html.substring(0,40));
    writeHabidocPage(html);
  }
  htmlFooter();
}

(async function main() {

  if (Argv.files) {
    var files = Argv.files.split(',');
    for (var i = 0; i < files.length; i++) {
        await Habitat2HTML(files[i]);
    }
  } else {
    console.log("No files specified, nothing done. See --help");
  }
}());

