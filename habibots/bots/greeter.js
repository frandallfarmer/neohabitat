/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const Defaults = {
  host:         '127.0.0.1',
  loglevel:     'debug',
  port:         1337,
  reconnect:    true,
  echoChat:     false,
  slackChannel: 'general',
  slackToken:   ''
};

const fs = require('fs');

var log = require('winston');
log.remove(log.transports.Console);
log.add(log.transports.Console, { 'timestamp': true });

const RtmClient = require('@slack/client').RtmClient;
const CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
const RTM_EVENTS = require('@slack/client').RTM_EVENTS;
const MemoryDataStore = require('@slack/client').MemoryDataStore;

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
  .option('greetingFile', { alias: 'g', describe: 'File to be played as a greeting.' })
  .option('reconnect', { alias: 'r', default: Defaults.reconnect, describe: 'Whether the bot should reconnect on disconnection.' })
  .option('slackToken', { alias: 's', default: Defaults.slackToken, describe: 'Token for sending user notifications to Slack.' })
  .option('slackChannel', { alias: 'l', default: Defaults.slackChannel, describe: 'Default Slack channel to use for notifications.' })
  .option('username', { alias: 'u', describe: 'Username of this bot.' })
  .option('echoChat', { alias: 'e', default: Defaults.echoChat, describe: 'Whether to echo in-world chat to Slack.' })
  .argv;

log.level = Argv.loglevel;

const GreeterBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username);
const GreetingText = fs.readFileSync(Argv.greetingFile).toString().replace(/\r/g, "").split('\n');

const SlackEnabled = Argv.slackToken !== '';
const SlackClient = new RtmClient(Argv.slackToken, {
  logLevel: 'error', 
  dataStore: new MemoryDataStore(),
  autoReconnect: true,
  autoMark: true 
});


let SlackChannelId;
SlackClient.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
  for (const c of rtmStartData.channels) {
    if (c.name === Argv.slackChannel) {
      SlackChannelId = c.id;
    }
  }
});


GreeterBot.on('OBJECTSPEAK_$', (bot, msg) => {
  if (msg.text.includes('has arrived.')) {
    var newAvatar = msg.text.substring(1).split(' has arrived.')[0];
    // Announces new user to Slack.
    if (SlackEnabled) {
      SlackClient.sendMessage(
        `New Avatar arrived in Habitat: ${newAvatar}`, SlackChannelId);
    }
  }
});


GreeterBot.on('APPEARING_$', (bot, msg) => {
  var avatar = bot.getNoid(msg.appearing);
  if (avatar == null) {
    log.error('No avatar found at noid: %s', msg.appearing);
    return;
  }

  // Faces the Avatar, waves to them, faces forward again, and says the greeting text.
  bot.faceDirection(bot.getDirection(avatar))
    .then(() => bot.doPosture(constants.WAVE))
    .then(() => bot.faceDirection(constants.FORWARD))
    .then(() => bot.sayLines(GreetingText))
});


GreeterBot.on('connected', (bot) => {
  log.debug('GreeterBot connected.');
  bot.gotoContext(Argv.context);
});


GreeterBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => bot.walkTo(84, 131, 1))
    .then(() => bot.faceDirection(constants.LEFT))
    .then(() => bot.doPosture(constants.WAVE))
    .then(() => bot.faceDirection(constants.FORWARD))
    .then(() => bot.say("Hey there! I'm Phil, the greeting bot!"))
    .then(() => SlackClient.sendMessage("GreeterBot engaged.", SlackChannelId))
});


// Installs Slack-to-Habitat chat bridging handlers if echo mode is enabled.
if (SlackEnabled && Argv.echoChat) {
  GreeterBot.on('SPEAK$', (bot, msg) => {
    // Don't echo out anything the bot itself says.
    if (msg.noid === bot.getAvatarNoid()) {
      return;
    }

    var avatar = bot.getNoid(msg.noid);
    if (avatar != null) {
      SlackClient.sendMessage(`${avatar.name}: ${msg.text}`, SlackChannelId);
    }
  });

  SlackClient.on(RTM_EVENTS.MESSAGE, (message) => {
    var username = SlackClient.dataStore.getUserById(message.user).name;
    GreeterBot.say(`@${username}: ${message.text}`);
  });

  log.debug('Slack chat echo enabled.')
}


GreeterBot.connect();


if (SlackEnabled) {
  SlackClient.start();
}
