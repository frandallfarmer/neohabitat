/* jslint bitwise: true */
/* jshint esversion: 6 */
/*
   This is a "special" bot and it requires some extra steps to get it running.
   0. (Optional?) Authorize your twitch account as a developer https://dev.twitch.tv/login
   1. Retrieve your OAuth token https://twitchapps.com/tmi/
   2. Setup your IRC channel https://help.twitch.tv/customer/portal/articles/1302780-twitch-irc
   3. Add "irc": "^0.5.2" to dependencies in package.json
   4. npm install (Build errors may appear, but you can ignore those)
*/
'use strict'

const Defaults = {
  host:      '127.0.0.1',
  loglevel:  'debug',
  port:      1337,
  reconnect: true,
}

var irc = require('irc')
var log = require('winston')
log.remove(log.transports.Console)
log.add(log.transports.Console, { 'timestamp': true })

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
  .argv

log.level = Argv.loglevel
const TwitchBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username)


var twitchIRC = new irc.Client('irc.twitch.tv', 'nickname', {
  debug: true,
  channels: ['#YourIRCChannel'],
  port: 6667,
  sasl: false,
  userName: "TwitchUserName",
  password: "oauth:XXXXXXXXXXXX",
  secure: false
})


TwitchBot.on('connected', (bot) => {
  log.debug('TwitchBot connected.')
  bot.gotoContext(Argv.context);
})

TwitchBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
})

twitchIRC.addListener('error', function(message) {
  console.error('ERROR: %s: %s', message.command, message.args.join(' '))
})

twitchIRC.addListener('message#blah', function(from, message) {
  console.log('<%s> %s', from, message)
})

twitchIRC.addListener('message', function(from, to, message) {
  console.log('%s => %s: %s', from, to, message)
  var op = message.toUpperCase().split(" ")
  switch(op[0]) {
    case "GO": //i.e. GO NORTH, SOUTH, etc
      TwitchBot.walkToExit(op[1])
      break
    case "POSTURE": //i.e. POSTURE WAVE
      TwitchBot.doPosture(op[1])
      break
    default:
      TwitchBot.say(message)
      break
  }
})

twitchIRC.addListener('join', function(channel, who) {
  console.log('%s has joined %s', who, channel)
})
twitchIRC.addListener('part', function(channel, who, reason) {
  console.log('%s has left %s: %s', who, channel, reason)
})

TwitchBot.connect()
