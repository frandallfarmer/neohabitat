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

const ProtesterBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username);
var lines = ["Taxes are too high!","Down with the mayor!","We deserve more tokens!","Down with corruption!", "The protest never ends!"];
var count = 0

ProtesterBot.on('connected', (bot) => {
  log.debug('ProtesterBot connected.');
  bot.gotoContext(Argv.context);
})

ProtesterBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => bot.say(lines.random()))
})

ProtesterBot.on('SPEAK$', (bot, msg) => {
    if (msg.noid === bot.getAvatarNoid()) {
      return
    }
    if (count == 0) {
      bot.say("Leave me alone, I'm on my break!")
      return
    }
    bot.say("Join us in our protest against the- Wait, what are we protesting again?")
    
})

ProtesterBot.on('APPEARING_$', (bot, msg) => {
  var avatar = bot.getNoid(msg.appearing)
  if (avatar == null) {
    log.error('No avatar found at noid: %s', msg.appearing);
    return
  }
  
  if (count > 3) {
    bot.say("Phew! I'm taking a break, all this protesting is making me tired.")
    count = 0
    return
  }
  
  count++
  bot.walkTo(32, 146, 0)
    .then(() => bot.say(lines.random()))
    .then(() => bot.walkTo(120, 160, 1))
    .then(() => bot.say(lines.random()))
    .then(() => bot.walkTo(80, 144, 1))
    .then(() => bot.say(lines.random()))
    .then(() => bot.faceDirection(constants.FORWARD))
})


ProtesterBot.connect()
