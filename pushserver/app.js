var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var IndexRoutes = require('./routes/index');
var EventsRoutes = require('./routes/events');

var log = require('winston');
// log.remove(log.transports.Console);
// log.add(log.transports.Console, { 'timestamp': true });
log.level = process.env.PUSH_SERVER_LOG_LEVEL || 'debug';

const winstonCommon = require('winston/lib/winston/common');

// Override to use real console.log etc for VSCode debugger
log.transports.Console.prototype.log = function (level, message, meta, callback) {
  const output = winstonCommon.log(Object.assign({}, this, {
    level,
    message,
    meta,
  }));

  console[level in console ? level : 'log'](output);

  setImmediate(callback, null, true);
};

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

/**
 * Starts the Habitat proxy service.
 */
var HabiproxyServer = require('./habiproxy/proxy');
var habiproxy = new HabiproxyServer(
  process.env.HABIPROXY_LISTEN_HOST || '0.0.0.0',
  process.env.HABIPROXY_LISTEN_PORT || '2018',
  process.env.HABIPROXY_ELKO_HOST || '0.0.0.0',
  process.env.HABIPROXY_ELKO_PORT || '9000'
);
habiproxy.start();

var YAML = require('yamljs');
var externalPages = YAML.load('./externalPages.yml');

// Establishes the PushServer's web application.
const indexRoutes = new IndexRoutes(habiproxy);
const eventsRoutes = new EventsRoutes(habiproxy, externalPages);

app.use('/', indexRoutes.router);
app.use('/events', eventsRoutes.router);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
