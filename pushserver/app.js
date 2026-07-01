var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var cookieSession = require('cookie-session');
var startWebsocketProxy = require('./websocketProxy');

var YAML = require('yamljs');
var config = YAML.load(process.env.PUSH_SERVER_CONFIG || './config.dev.yml');

var log = require('winston');
log.level = process.env.PUSH_SERVER_LOG_LEVEL || 'debug';

startWebsocketProxy({
  source: config.websocketProxy.listenAddr,
  target: config.websocketProxy.remoteAddr,
});

log.configure({
  transports: [new log.transports.Console({
    format: log.format.combine(log.format.timestamp(), log.format.splat(), log.format.simple())
  })]
});

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
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Alpha web client. Co-presence traffic pacing has landed (Phase 7d wire pacing + the busy/wait
// cursor's co-presence delays), so the page is now open in prod; config.alphaPassword (unset by
// default) re-gates it behind a shared password if needed. Served here because the page needs its
// sibling libs as siblings under the host root: webclient/, habisound/, habiworld/ live next to
// pushserver/ in the repo/image.
var ALPHA_PW = config.alphaPassword;
function alphaGate(req, res, next) {
  if (!ALPHA_PW) return next();
  var parts = (req.headers.authorization || '').split(' ');
  var creds = Buffer.from(parts[1] || '', 'base64').toString().split(':');
  if (creds[1] === ALPHA_PW) return next();
  res.set('WWW-Authenticate', 'Basic realm="Neohabitat Alpha"').status(401).end('Authentication required.');
}
var repoRoot = path.join(__dirname, '..');

// The Alpha client needs a secure context (habisound AudioWorklet) and a wss game socket, so it
// must run over HTTPS. In prod the Caddy front terminates TLS on :443 and proxies to us with
// X-Forwarded-Proto: https; a request without that header arrived over plain HTTP on :80, so bounce
// it up to the HTTPS URL. /webclient is forced — and so is /neohabitat: the docent page EMBEDS the
// webclient in an iframe, and a secure context requires the WHOLE ancestor chain to be https, so an
// http docent page would leave the iframe non-secure and kill its AudioWorklet sound. /habisound and
// /habiworld are shared libs that other plain-HTTP pages may embed, so they are not forced (the HTTPS
// client already fetches them over https via Caddy).
// Gated on config.requireHttps so local dev (no TLS) is unaffected.
function forceHttps(req, res, next) {
  if (config.requireHttps && req.headers['x-forwarded-proto'] !== 'https') {
    var host = (req.headers.host || 'habitat.themade.org').replace(/:\d+$/, '');
    return res.redirect(302, 'https://' + host + req.originalUrl);
  }
  next();
}
app.use('/webclient', forceHttps);
app.use('/neohabitat', forceHttps);

['webclient', 'habisound', 'habiworld'].forEach(function (dir) {
  app.use('/' + dir, alphaGate, express.static(path.join(repoRoot, dir)));
});

app.use(cookieSession({
  name: 'session',
  keys: config.cookieSessionKeys,
  maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
}));

module.exports = app;
