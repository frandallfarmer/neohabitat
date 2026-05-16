const EventEmitter = require('events');

function normalizeAvatarName(avatarName) {
  if (!avatarName) {
    return '';
  }
  return avatarName.trim().toLowerCase();
}

class DocentTracker extends EventEmitter {
  constructor() {
    super();
    this.docentAvatars = {};
    this.hatcheryDocents = {};
  }

  clear() {
    this.docentAvatars = {};
    this.hatcheryDocents = {};
  }

  registerLogin(docentSessionId, avatarName) {
    if (!docentSessionId || !avatarName) {
      return;
    }
    this.docentAvatars[docentSessionId] = avatarName;
    this.emit('login', docentSessionId, avatarName);
  }

  avatarForDocent(docentSessionId) {
    return this.docentAvatars[docentSessionId] || null;
  }

  docentMatchesAvatar(docentSessionId, avatarName) {
    return !!avatarName &&
      normalizeAvatarName(this.avatarForDocent(docentSessionId)) === normalizeAvatarName(avatarName);
  }

  markHatchery(docentSessionId) {
    if (!docentSessionId) {
      return;
    }
    this.hatcheryDocents[docentSessionId] = true;
  }

  isHatcheryDocent(docentSessionId) {
    return this.hatcheryDocents[docentSessionId] === true;
  }

  handleSessionReady(session) {
    if (session == null || session.avatarName == null || session.avatarName === 'unknown') {
      return;
    }
    var docentSessionIds = Object.keys(this.docentAvatars);
    for (var i in docentSessionIds) {
      var docentSessionId = docentSessionIds[i];
      if (this.docentMatchesAvatar(docentSessionId, session.avatarName)) {
        this.emit('avatarReady', docentSessionId, session.avatarName);
      }
    }
  }
}

module.exports = new DocentTracker();
