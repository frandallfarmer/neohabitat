/* jshint esversion: 8 */

'use strict'

// Openable.java — OPEN/CLOSE set open_flags and gr_state together (0=closed, 1=open).
// The renderer picks the prop animation from gr_state, not open_flags.

const { OPEN_BIT } = require('./constants')

function syncOpenableGrState(mod) {
  mod.gr_state = (mod.open_flags || 0) & OPEN_BIT ? 1 : 0
}

function setOpenFlags(mod, openFlags) {
  mod.open_flags = openFlags
  syncOpenableGrState(mod)
}

module.exports = { syncOpenableGrState, setOpenFlags }