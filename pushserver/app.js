var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var cookieSession = require('cookie-session');
var bodyParser = require('body-parser');
var startWebsocketProxy = require('./websocketProxy');

var YAML = require('yamljs');
var config = YAML.load(process.env.PUSH_SERVER_CONFIG || './config.dev.yml');

var log = require('winston');
log.level = process.env.PUSH_SERVER_LOG_LEVEL || 'debug';

startWebsocketProxy({
  source: config.websocketProxy.listenAddr,
  target: config.websocketProxy.remoteAddr,
});

// Override to use real console.log etc for the Chrome/VSCode debugger.
var logToDebugger = process.env.LOG_TO_DEBUGGER || 'true';

if (logToDebugger === 'true') {
  var winstonCommon = require('winston/lib/winston/common');

  log.transports.Console.prototype.log = function (level, message, meta, callback) {
    const output = winstonCommon.log(Object.assign({}, this, {
      level,
      message,
      meta,
    }));

    console[level in console ? level : 'log'](output);

    setImmediate(callback, null, true);
  };
} else {
  log.remove(log.transports.Console);
  log.add(log.transports.Console, { 'timestamp': true });
}

// Ensures all Markdown is rendered as GitHub Flavored Markdown.
// (Swapped from `showdown` to `marked` — showdown's only open advisory
// has no upstream fix; marked is actively maintained.) Sets process-
// wide defaults so the converter instances in routes/docs.js inherit
// them — gfm:true is the marked equivalent of showdown's
// setFlavor('github'), breaks:false matches showdown's default
// simpleLineBreaks:false.
var marked = require('marked');
marked.setOptions({ gfm: true, breaks: false });

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(cookieSession({
  name: 'session',
  keys: config.cookieSessionKeys,
  maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
}));

module.exports = app;
