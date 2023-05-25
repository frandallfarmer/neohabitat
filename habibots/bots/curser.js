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

const CurserBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username);

CurserBot.on('connected', (bot) => {
  log.debug('CurserBot connected.')
  bot.gotoContext(Argv.context)
})

CurserBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
  if (bot.getAvatar().mods[0].curse_count <= 0) {
    log.debug('CurserBot is cured.');
    return
  }
  var avatar = bot.collectAvatarNoids().random()
  if (avatar == null) {
    bot.wait(20000)
      .then(() => bot.walkToRandomExit())
      return
  } else if (avatar.mods[0].curse_type != 0) { 
    bot.wait(20000)
      .then(() => bot.walkToRandomExit())
      return
  } else {
    bot.walkToAvatar(avatar)
      .then(() => bot.touchAvatar(avatar.mods[0].noid))
      .then(() => bot.say("Enjoy the new head!"))
      .then(() => bot.walkToRandomExit())
  }
})

CurserBot.on('APPEARING_$', (bot, msg) => {
  var avatar = bot.getNoid(msg.appearing)
  if (avatar == null || avatar.mods[0].curse_type != 0) {
    return
  }
  
  bot.walkToAvatar(avatar)
    .then(() => bot.touchAvatar(avatar.mods[0].noid))
    .then(() => bot.say("Enjoy the new head!"))
    .then(() => bot.walkToRandomExit())
})

CurserBot.connect()
