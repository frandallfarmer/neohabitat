/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const Defaults = {
  host:         '127.0.0.1',
  loglevel:     'debug',
  port:         1337,
  reconnect:    true,
  echoChat:     false,
};

var log = require('winston');
log.remove(log.transports.Console);
log.add(log.transports.Console, { 'timestamp': true });

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
  .option('echoChat', { alias: 'e', default: Defaults.echoChat, describe: 'Whether to echo in-world chat to Slack.' })
  .argv;

log.level = Argv.loglevel;

const ConnectorBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username);

ConnectorBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => bot.say("Hey there, I connected!"))
});

ConnectorBot.on('connected', (bot) => {
  log.debug('ConnectorBot connected.');
  bot.gotoContext(Argv.context);
});

ConnectorBot.connect();
