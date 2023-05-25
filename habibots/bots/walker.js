/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const Defaults = {
  host:      '127.0.0.1',
  loglevel:  'debug',
  port:      1337,
  reconnect: true,
};

var log = require('winston');
log.remove(log.transports.Console);
log.add(log.transports.Console, { 'timestamp': true });

const constants = require('../constants');
const HabiBot = require('../habibot');

const Argv = require('yargs')
  .usage('Usage: $0 [options]')
  .help('help')
  .option('help', { alias: '?', describe: 'Get this usage/help information.' })
  .option('host', { alias: 'h', default: Defaults.host, describe: 'Host name or address of the Elko server.' })
  .option('loglevel',  { alias: ';', default: Defaults.loglevel, describe: 'Log level name. (see: npm winston)'})
  .option('port', { alias: 'p', default: Defaults.port, describe: 'Port number for the Elko server.' })
  .option('context', { alias: 'c', describe: 'Context to enter.' })
  .option('reconnect', { alias: 'r', default: Defaults.reconnect, describe: 'Whether the bot should reconnect on disconnection.' })
  .option('username', { alias: 'u', describe: 'Username of this bot.' })
  .argv;

log.level = Argv.loglevel;

const WalkerBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username);

WalkerBot.on('connected', (bot) => {
  log.debug('WalkerBot connected.');
  bot.gotoContext(Argv.context);
})

var stage = 0
var path = [
  'EAST',
  'NORTH',
  'WEST',
  'SOUTH',
]

WalkerBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => bot.say("Oh hey, I'm a bot that's just wandering around, don't mind me!"))
    .then(() => bot.walkToExit(path[stage++]))
})

WalkerBot.connect()
