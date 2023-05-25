/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict'

const Defaults = {
  host:      '127.0.0.1',
  loglevel:  'debug',
  port:      1337,
  reconnect: true,
}

var eliza = require('elizabot')
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

const ElizaBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username)
var Eliza = new eliza(true)
Eliza.memSize = 100

ElizaBot.on('connected', (bot) => {
  log.debug('ElizaBot connected.')
  bot.gotoContext(Argv.context)
})

ElizaBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => bot.walkTo(80, 142, 0))
    .then(() => bot.faceDirection(constants.FORWARD))
    .then(() => bot.say(Eliza.getInitial()))
})

ElizaBot.on('APPEARING_$', (bot, msg) => {
  var avatar = bot.getNoid(msg.appearing)
  if (avatar == null) {
    return
  }
  bot.say(Eliza.getInitial())
})

ElizaBot.on('SPEAK$', (bot, msg) => {
  if (msg.noid === bot.getAvatarNoid()) {
    return
  }
    
  bot.say(Eliza.transform(msg.text))
  if (Eliza.quit) { // Reset Eliza if the user quits
    Eliza.reset()
  }
})

ElizaBot.connect()
