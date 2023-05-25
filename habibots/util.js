/* jslint bitwise: true */
/* jshint esversion: 6 */

'use strict';

const log = require('winston');

Array.prototype.random = function () {
  return this[Math.floor((Math.random()*this.length))];
}

/**
 * Clones a JavaScript Object, borrowed from:
 * https://stackoverflow.com/posts/728694/revisions
 * @param {Object} Object to clone
 * @returns {Object} Cloned object
 */
function clone(obj) {
  var copy;

  // Handle the 3 simple types, and null or undefined
  if (null == obj || "object" != typeof obj) return obj;

  // Handle Date
  if (obj instanceof Date) {
    copy = new Date();
    copy.setTime(obj.getTime());
    return copy;
  }

  // Handle Array
  if (obj instanceof Array) {
    copy = [];
    for (var i = 0, len = obj.length; i < len; i++) {
      copy[i] = clone(obj[i]);
    }
    return copy;
  }

  // Handle Object
  if (obj instanceof Object) {
    copy = {};
    for (var attr in obj) {
      if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
    }
    return copy;
  }

  throw new Error("Unable to copy obj! Its type isn't supported.");
}


/**
 * JSON parses one or more Elko messages, handling parse errors.
 * 
 * @param Buffer buffer A buffer from a TCP onReceive callback
 * @returns List A list of parsed Elko messages
 */
function parseElko(buffer) {
  var parsedMessages = [];
  var messages = buffer.toString().split('\n');
  for (var i in messages) {
    if (messages[i].length == 0) {
      continue;
    }
    try {
      var parsedMessage = JSON.parse(messages[i]);
      parsedMessages.push(parsedMessage);
    } catch (e) {
      log.warn("Unable to parse: " + buffer + "\n\n" + JSON.stringify(e, null, 2));
    }
  }
  return parsedMessages;
}


module.exports = Object.freeze({
  clone: clone,
  parseElko: parseElko,
});
