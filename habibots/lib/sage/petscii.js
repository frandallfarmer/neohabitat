/* jslint bitwise: true */
/* jshint esversion: 8 */

'use strict'

// petscii.js — strip / fold any non-PETSCII characters out of any text
// the bot is about to send to the C64 wire. Symptom of NOT calling this:
// the C64 client shows garbage block glyphs where the multi-byte UTF-8
// of a smart-quote, em-dash, or emoji landed (each byte renders as its
// own PETSCII char).
//
// Used by sage.js for SPEAK output AND by lib/sage/tools.js for whisper
// (ESP) text. Any new tool that pushes a Claude-generated string to the
// wire should run it through here first — the system prompt asks Claude
// to stay in ASCII, but it slips occasionally.

function sanitizeForC64(text) {
  if (!text) return text
  return text
    // Common typography that an LLM produces by default.
    .replace(/[‘’‚‛]/g, "'")    // fancy single quotes
    .replace(/[“”„‟]/g, '"')    // fancy double quotes
    .replace(/[–—―]/g, '-')          // en/em/horizontal dash
    .replace(/…/g, '...')                      // ellipsis
    .replace(/[     ]/g, ' ') // non-breaking / thin spaces
    .replace(/[·•]/g, '*')                // middle dot / bullet
    // Emoji ranges → :-) so the bot still acknowledges affect even
    // though the original glyph is gone. Multiple matches collapse
    // to a single :-) below.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, ':-)')
    // Final pass: any byte still outside printable ASCII gets dropped.
    // Includes stray combining marks, zero-width joiners, etc.
    .replace(/[^\x20-\x7E]/g, '')
    // Collapse any duplicated :-) the emoji-fold introduced.
    .replace(/(:-\))(\s*:-\))+/g, '$1')
    .trim()
}

module.exports = { sanitizeForC64 }
