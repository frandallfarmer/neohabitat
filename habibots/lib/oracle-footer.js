/* jshint esversion: 8 */

'use strict'

// oracle-footer.js — reads the routing key bridge_v2 stamps on an oracle
// request. This is one half of a cross-language contract; the other half
// is formatOracleFooter in bridge_v2/bridge/oracle.go. Isolated here so
// both ends can be tested against the same examples.
//
// Format: "<user ref> · <display name>", e.g. "user-randy · Randy".
//
// Both fields are carried because they are not interchangeable. The ref
// identifies the account for logs; Habitat mail is addressed by DISPLAY
// NAME, since Region.addUser keys NameToUser on name().toLowerCase() and
// Avatar.mailQueueRef() is "mail-" + that. The ref cannot recover the
// name: ensureUserCreated builds it by lowercasing the name and mapping
// spaces to underscores, and names may contain underscores themselves.
//
// The name is free-form, so it goes LAST and everything after the ref is
// rejoined — a name containing the separator still round-trips.

const SEPARATOR = ' · '
const REF_PREFIX = 'user-'

// Returns { userRef, name } or null when this is not an oracle request.
function askerFromFooter(text) {
  if (!text) return null
  const parts = String(text).split(SEPARATOR)
  if (parts.length < 2) return null
  const userRef = parts[0].trim()
  const name = parts.slice(1).join(SEPARATOR).trim()
  if (!userRef.startsWith(REF_PREFIX) || userRef.length <= REF_PREFIX.length || !name) return null
  return { userRef: userRef, name: name }
}

// Convenience for a discord.js Message: the relay posts exactly one embed.
function askerFromMessage(msg) {
  const embed = msg && msg.embeds && msg.embeds[0]
  return askerFromFooter(embed && embed.footer && embed.footer.text)
}

module.exports = { askerFromFooter, askerFromMessage, SEPARATOR }
