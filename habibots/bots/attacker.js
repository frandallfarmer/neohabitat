/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict'

const Defaults = {
  host:      '127.0.0.1',
  loglevel:  'debug',
  port:      1337,
  reconnect: true,
}

var log = require('winston')
log.remove(log.transports.Console)
log.add(log.transports.Console, { 'timestamp': true })

const constants = require('../constants')
const HabiBot = require('../habibot')

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
  .argv

log.level = Argv.loglevel

const AttackerBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username)

AttackerBot.on('connected', (bot) => {
  log.debug('AttackerBot connected.')
  bot.gotoContext(Argv.context)
})

AttackerBot.on('enteredRegion', (bot, me) => {
  var victim = bot.collectAvatarNoids().random()
  if (bot.currentRealm() != "Back4t") {
    bot.newRegion(2)
      .then(() => bot.gotoContext("context-back4t_25"))
      return
  } else if (victim == null) {
    bot.wait(20000)
      .then(() => bot.walkToRandomExit())
      return
  }

  bot.ensureCorporated()
    .then(() => bot.wait(2000))
    .then(() => bot.say("You're dead meat!"))
    .then(() => bot.attackAvatar(bot.getNoid(bot.getAvatarNoid()-3).ref, victim.mods[0].noid))
    .then(() => bot.attackAvatar(bot.getNoid(bot.getAvatarNoid()-3).ref, victim.mods[0].noid))
    .then(() => bot.attackAvatar(bot.getNoid(bot.getAvatarNoid()-3).ref, victim.mods[0].noid))
    .then(() => bot.walkToRandomExit())
})

AttackerBot.on('APPEARING_$', (bot, msg) => {
  var avatar = bot.getNoid(msg.appearing)
  if (avatar == null) {
    return
  }
  
  bot.say("You're dead meat!")
    .then(() => bot.attackAvatar(bot.getNoid(bot.getAvatarNoid()-3).ref, msg.noid))
    .then(() => bot.attackAvatar(bot.getNoid(bot.getAvatarNoid()-3).ref, msg.noid))
    .then(() => bot.walkToRandomExit())
})

AttackerBot.connect()
