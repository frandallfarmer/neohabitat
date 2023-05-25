/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict'

const Defaults = {
  host:         '127.0.0.1',
  loglevel:     'debug',
  port:         1337,
  reconnect:    true,
  slackChannel: 'general',
}

const fs = require('fs')
var log = require('winston')
log.remove(log.transports.Console)
log.add(log.transports.Console, { 'timestamp': true })

const RtmClient = require('@slack/client').RtmClient
const CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS
const RTM_EVENTS = require('@slack/client').RTM_EVENTS
const MemoryDataStore = require('@slack/client').MemoryDataStore

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
  .option('slackToken', { alias: 's', default: Defaults.slackToken, describe: 'Token for sending user notifications to Slack.' })
  .option('slackChannel', { alias: 'l', default: Defaults.slackChannel, describe: 'Default Slack channel to use for notifications.' })
  .option('username', { alias: 'u', describe: 'Username of this bot.' })
  .argv

log.level = Argv.loglevel

const OracleBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username)

const SlackEnabled = Argv.slackToken !== ''
const SlackClient = new RtmClient(Argv.slackToken, {
  logLevel: 'error', 
  dataStore: new MemoryDataStore(),
  autoReconnect: true,
  autoMark: true 
})

let SlackChannelId
SlackClient.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
  for (const c of rtmStartData.channels) {
    if (c.name === Argv.slackChannel) {
      SlackChannelId = c.id 
    }
  }
})

OracleBot.on('connected', (bot) => {
  log.debug('OracleBot connected.')
  bot.gotoContext(Argv.context)
})

OracleBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => SlackClient.sendMessage("OracleBot engaged.", SlackChannelId))
})

OracleBot.on('OBJECTSPEAK_$', (bot, msg) => {
  if (msg.noid === bot.getAvatarNoid()) {
    return
  }
    
  if (msg.text.includes("says:")) { //JSN: This is silly, but for now it's fine.
    SlackClient.sendMessage(`${msg.text}`, SlackChannelId)    
  }
})

SlackClient.on(RTM_EVENTS.MESSAGE, (message) => {
  if (!message.text.includes(":")) {
    SlackClient.sendMessage("Error! Input did not follow *'USERNAME: Message'* format.", SlackChannelId)
    return
  }
  var msg = message.text.split(":") 
    OracleBot.wait(10000)
      .then(() => OracleBot.say("TO: " + msg[0]))
      .then(() => OracleBot.wait(5000))
      .then(() => OracleBot.ESPsay(msg[1]))
      .then(() => OracleBot.wait(5000))
      .then(() => OracleBot.ESPsay(""))
})

OracleBot.connect()

if (SlackEnabled) {
  SlackClient.start()
}
