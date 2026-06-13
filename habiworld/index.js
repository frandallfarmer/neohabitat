/* jshint esversion: 8 */

'use strict'

const { HabitatWorld } = require('./lib/world')
const constants = require('./lib/constants')
const { DELTAS } = require('./lib/deltas')
const actions = require('./lib/actions')
const behaviors = require('./lib/behaviors')
const { dispatch } = require('./lib/behaviors/dispatch')
const classes = require('./lib/classes')

module.exports = { HabitatWorld, constants, DELTAS, actions, behaviors, dispatch, classes }
