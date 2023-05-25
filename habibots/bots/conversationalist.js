/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const Defaults = {
  host:         '127.0.0.1',
  loglevel:     'debug',
  port:         1337,
  reconnect:    true,
  witToken:     '',
};

var log = require('winston');
log.remove(log.transports.Console);
log.add(log.transports.Console, { 'timestamp': true });

const constants = require('../constants');
const HabiBot = require('../habibot');

const GoogleMapsAPI = require('googlemaps');
const Wit = require('node-wit').Wit;
const Wunderground = require('wundergroundnode');

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
  .option('googleMapsKey', { alias: 'g', default: Defaults.witToken, describe: 'Key for connecting to the Google Maps API.' })
  .option('weatherUndergroundKey', { alias: 'u', describe: 'Key for Weather Underground API access.'})
  .option('witToken', { alias: 'w', default: Defaults.witToken, describe: 'Token for connecting to wit.ai.' })
  .argv;

log.level = Argv.loglevel;


const ConversationBot = HabiBot.newWithConfig(Argv.host, Argv.port, Argv.username);
const GoogleMapsClient = new GoogleMapsAPI({
  key: Argv.googleMapsKey,
  secure: true,
});
const WundergroundClient = new Wunderground(Argv.weatherUndergroundKey)

const actions = {
  send(request, response) {
    const {sessionId, context, entities} = request;
    const {text, quickreplies} = response;
    return ConversationBot.say(text)
  },
  getForecast({context, entities}) {
    var location = firstEntityValue(entities, 'location');
    context.weather = location
    return context
  },
}


const WitClient = new Wit({
  accessToken: Argv.witToken,
  actions: actions,
  logger: log,
});


const firstEntityValue = (entities, entity) => {
  const val = entities && entities[entity] &&
    Array.isArray(entities[entity]) &&
    entities[entity].length > 0 &&
    entities[entity][0].value
  ;
  if (!val) {
    return null;
  }
  return typeof val === 'object' ? val.value : val;
};


ConversationBot.on('connected', (bot) => {
  log.debug('ConversationBot connected.');
  bot.gotoContext(Argv.context);
});


ConversationBot.on('SPEAK$', (bot, msg) => {
  // Don't echo out anything the bot itself says.
  if (msg.noid === bot.getAvatarNoid()) {
    return;
  }

  var avatar = bot.getNoid(msg.noid);
  if (avatar != null) {
    var cleanMsg = msg.text.trim();
    if (cleanMsg.toLowerCase().startsWith('tony,')) {
      var witMsg = cleanMsg.substring(5, cleanMsg.length);
      WitClient.message(witMsg, {})
        .then((data) => {
          if ('weather_forecast' in data.entities) {
            if ('location' in data.entities) {
              var location = firstEntityValue(data.entities, 'location');
              GoogleMapsClient.geocode({address: location}, function(err, result) {
                if (err) {
                  log.error(err);
                  return
                }
                log.debug(result);
                var firstResult = result.results[0];
                let country;
                let city;
                let state;
                let postalCode;
                for (var component of firstResult.address_components) {
                  if ('country' in component.types) {
                    country = component.short_name;
                  } else if ('administrative_area_level_1' in component.types) {
                    state = component.short_name;
                  } else if ('sublocality' in component.types) {
                    city = component.short_name;
                  } else if ('postal_code' in component.types) {
                    postalCode = component.short_name;
                  }
                }
                if (postalCode) {
                  WundergroundClient.conditions().request(postalCode, function(err, response) {
                    if (err) {
                      log.error(err);
                      return;
                    }
                    log.debug(response);
                    ConversationBot.say(`The weather in ${city}, ${state} ${country} is ${response.weather} and ${response.temp_f} degrees F.`)
                  })
                }
              })
            }
          }
        })
    }
  }
})


ConversationBot.on('enteredRegion', (bot, me) => {
  bot.ensureCorporated()
    .then(() => bot.walkTo(54, 111))
    .then(() => bot.faceDirection(constants.LEFT))
    .then(() => bot.doPosture(constants.WAVE))
    .then(() => bot.faceDirection(constants.FORWARD))
    .then(() => bot.say("Hey there! I'm Tony Banks, the conversation bot!"))
});


ConversationBot.connect();
