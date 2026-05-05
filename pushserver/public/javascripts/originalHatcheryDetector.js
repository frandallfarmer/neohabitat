(function() {
  if (window.NeoHabitatOriginalHatcheryDetectorInstalled) {
    return;
  }
  window.NeoHabitatOriginalHatcheryDetectorInstalled = true;

  var originalHatcheryDoc = '/docs/region/ORIGINAL_HATCHERY';
  var fallbackDoc = '/docs/region/EMULATOR_HELP';

  // The bridge sends byte(2) followed by HatcheryCustomizationVector. It is
  // split after 100 payload bytes, so match the first chunk and wildcard the
  // randomized head-style bytes.
  var hatcherySignature = [
    2,
    0, 0, 32, 0, 1, 0, 0, 0, 0,
    1, 1, 2, 36, 3, 80, 4, 127,
    5, 127, 6, 127, 7, 127, 8, 127,
    9, 127, 10, 127, 11, 127, 0,
    0, 84, 144, 2, 0, 0, 146, 146,
    0, 0, 2, 52,
    1, 0, 4, 228, 0, 0,
    4, 0, 0, 196, 0, 0,
    null, 200, 36, 16, 1, 0,
    null, 200, 38, 16, 1, 0,
    null, 200, 38, 16, 1, 0,
    null, 200, 198, 16, 1, 0,
    null, 200, 36, 16, 1, 0,
    null, 200, 37, 16, 1, 0,
    null, 200, 60, 16, 1, 0,
    null
  ];

  var detected = false;
  var hatcheryActive = false;
  var pendingAvatarName = null;
  var autoTrackStarted = false;
  var avatarsBeforeHatchery = null;
  var rollingBuffer = [];
  var maxBufferLength = hatcherySignature.length + 256;
  var NativeWebSocket = window.WebSocket;

  function showOriginalHatcheryDoc() {
    detected = true;
    hatcheryActive = true;
    rememberCurrentAvatars();
    var docsFrame = document.getElementById('docsFrame');
    if (docsFrame !== null) {
      docsFrame.setAttribute('src', originalHatcheryDoc);
    }
  }

  function leaveOriginalHatcheryDoc() {
    hatcheryActive = false;
    var docsFrame = document.getElementById('docsFrame');
    if (docsFrame !== null && docsFrame.getAttribute('src') === originalHatcheryDoc) {
      docsFrame.setAttribute('src', window.EmulatorHelpPage || fallbackDoc);
    }
    startDocentAutoTrack();
  }

  function decodeUtf8(bytes) {
    if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) {
      bytes = new Uint8Array(bytes);
    }

    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }

    var text = '';
    for (var i = 0; i < bytes.length; i++) {
      text += String.fromCharCode(bytes[i] & 0xff);
    }
    return text;
  }

  function rememberAvatarNameFromText(text) {
    if (pendingAvatarName !== null) {
      return;
    }

    var match = /"name"\s*:\s*"([^"]+)"/.exec(text);
    if (match !== null) {
      pendingAvatarName = match[1];
    }
  }

  function isTrackableAvatar(avatarObj) {
    return avatarObj !== null &&
      avatarObj !== undefined &&
      typeof avatarObj.avatar === 'string' &&
      avatarObj.avatar.toLowerCase().indexOf('bot') === -1;
  }

  function trackableAvatarNames(avatars) {
    var names = [];
    for (var i = 0; i < avatars.length; i++) {
      if (isTrackableAvatar(avatars[i])) {
        names.push(avatars[i].avatar);
      }
    }
    return names;
  }

  function rememberCurrentAvatars() {
    if (avatarsBeforeHatchery !== null ||
        typeof window.$ === 'undefined' ||
        typeof window.$.get !== 'function') {
      return;
    }

    var request = window.$.get('/api/v1/worldview/avatars', function(data) {
      var avatars = data && data.avatars ? data.avatars : [];
      avatarsBeforeHatchery = trackableAvatarNames(avatars);
    }, 'json');

    if (request !== undefined && request !== null && typeof request.fail === 'function') {
      request.fail(function() {
        avatarsBeforeHatchery = [];
      });
    }
  }

  function findPendingAvatar(avatars) {
    if (pendingAvatarName !== null) {
      var target = pendingAvatarName.toLowerCase();
      for (var i = 0; i < avatars.length; i++) {
        if (isTrackableAvatar(avatars[i]) && avatars[i].avatar.toLowerCase() === target) {
          return avatars[i].avatar;
        }
      }
    }

    var trackableNames = trackableAvatarNames(avatars);
    if (avatarsBeforeHatchery === null) {
      if (trackableNames.length === 1) {
        return trackableNames[0];
      }
      return null;
    }

    var previousNames = {};
    for (var j = 0; j < avatarsBeforeHatchery.length; j++) {
      previousNames[avatarsBeforeHatchery[j].toLowerCase()] = true;
    }

    var newNames = [];
    for (var k = 0; k < trackableNames.length; k++) {
      if (!previousNames[trackableNames[k].toLowerCase()]) {
        newNames.push(trackableNames[k]);
      }
    }

    if (newNames.length === 1) {
      return newNames[0];
    }

    return null;
  }

  function startDocentAutoTrack() {
    if (autoTrackStarted || (pendingAvatarName === null && avatarsBeforeHatchery === null)) {
      return;
    }

    autoTrackStarted = true;
    pollForAvatarAndTrack(30);
  }

  function pollForAvatarAndTrack(remainingAttempts) {
    if (remainingAttempts <= 0 || typeof window.trackAvatar !== 'function') {
      return;
    }

    if (typeof window.$ === 'undefined' || typeof window.$.get !== 'function') {
      setTimeout(function() {
        pollForAvatarAndTrack(remainingAttempts - 1);
      }, 1000);
      return;
    }

    var request = window.$.get('/api/v1/worldview/avatars', function(data) {
      var avatars = data && data.avatars ? data.avatars : [];
      var avatarName = findPendingAvatar(avatars);
      if (avatarName !== null) {
        window.trackAvatar(avatarName);
        return;
      }

      setTimeout(function() {
        pollForAvatarAndTrack(remainingAttempts - 1);
      }, 1000);
    }, 'json');

    if (request !== undefined && request !== null && typeof request.fail === 'function') {
      request.fail(function() {
        setTimeout(function() {
          pollForAvatarAndTrack(remainingAttempts - 1);
        }, 1000);
      });
    }
  }

  function signatureMatchesAt(bytes, offset) {
    for (var i = 0; i < hatcherySignature.length; i++) {
      var expected = hatcherySignature[i];
      if (expected !== null && bytes[offset + i] !== expected) {
        return false;
      }
    }
    return true;
  }

  function descapeHabitatPacket(bytes, offset) {
    var descaped = [];
    for (var i = offset; i < bytes.length; i++) {
      var curByte = bytes[i] & 0xff;
      if (curByte === 0x5d) {
        i++;
        if (i >= bytes.length) {
          break;
        }
        curByte = (bytes[i] & 0xff) ^ 0x55;
      }
      descaped.push(curByte);
    }
    return descaped;
  }

  function findHabitatPacket(bytes, callback) {
    for (var offset = 0; offset <= bytes.length - 4; offset++) {
      var habitatPacket;

      if (bytes[offset] === 0x5a && bytes[offset + 7] === 0x20) {
        // Habilink/QLink Action frame. The Habitat packet starts at byte 8.
        habitatPacket = descapeHabitatPacket(bytes, offset + 8);
      } else if (bytes[offset] === 0x55) {
        // Plain Habitat packet.
        habitatPacket = descapeHabitatPacket(bytes, offset);
      } else {
        continue;
      }

      if (callback(habitatPacket)) {
        return;
      }
    }
  }

  function isCustomizePacket(habitatPacket) {
    return habitatPacket.length >= 9 &&
      habitatPacket[0] === 0x55 &&
      habitatPacket[2] === 0 &&
      habitatPacket[3] === 4;
  }

  function isCustomizeSuccessReply(habitatPacket) {
    return habitatPacket.length >= 5 &&
      habitatPacket[0] === 0x55 &&
      habitatPacket[2] === 0 &&
      habitatPacket[3] === 4 &&
      habitatPacket[4] === 1;
  }

  function inspectInboundBytes(bytes) {
    if (bytes.length === 0) {
      return;
    }

    if (hatcheryActive) {
      findHabitatPacket(bytes, function(habitatPacket) {
        if (isCustomizeSuccessReply(habitatPacket)) {
          leaveOriginalHatcheryDoc();
          return true;
        }
        return false;
      });
    }

    if (detected) {
      return;
    }

    for (var i = 0; i < bytes.length; i++) {
      rollingBuffer.push(bytes[i] & 0xff);
    }
    if (rollingBuffer.length > maxBufferLength) {
      rollingBuffer = rollingBuffer.slice(rollingBuffer.length - maxBufferLength);
    }
    for (var offset = 0; offset <= rollingBuffer.length - hatcherySignature.length; offset++) {
      if (signatureMatchesAt(rollingBuffer, offset)) {
        showOriginalHatcheryDoc();
        return;
      }
    }
  }

  function inspectOutboundBytes(bytes) {
    rememberAvatarNameFromText(decodeUtf8(bytes));

    if (!hatcheryActive || bytes.length === 0) {
      return;
    }

    findHabitatPacket(bytes, function(habitatPacket) {
      if (isCustomizePacket(habitatPacket)) {
        leaveOriginalHatcheryDoc();
        return true;
      }
      return false;
    });
  }

  function inspectString(data) {
    var bytes = [];
    for (var i = 0; i < data.length; i++) {
      bytes.push(data.charCodeAt(i) & 0xff);
    }
    inspectInboundBytes(bytes);
  }

  function inspectBlob(data) {
    var reader = new FileReader();
    reader.onload = function() {
      inspectInboundBytes(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(data);
  }

  function inspectMessageData(data) {
    if (data === undefined || data === null) {
      return;
    }
    if (typeof data === 'string') {
      inspectString(data);
    } else if (data instanceof ArrayBuffer) {
      inspectInboundBytes(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      inspectInboundBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      inspectBlob(data);
    }
  }

  function inspectOutboundData(data) {
    if (data === undefined || data === null) {
      return;
    }
    if (typeof data === 'string') {
      rememberAvatarNameFromText(data);
      var bytes = [];
      for (var i = 0; i < data.length; i++) {
        bytes.push(data.charCodeAt(i) & 0xff);
      }
      inspectOutboundBytes(bytes);
    } else if (data instanceof ArrayBuffer) {
      inspectOutboundBytes(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      inspectOutboundBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  function WrappedWebSocket(url, protocols) {
    var socket;
    if (protocols !== undefined) {
      socket = new NativeWebSocket(url, protocols);
    } else {
      socket = new NativeWebSocket(url);
    }
    socket.addEventListener('message', function(event) {
      inspectMessageData(event.data);
    });
    var nativeSend = socket.send;
    socket.send = function(data) {
      inspectOutboundData(data);
      return nativeSend.call(socket, data);
    };
    return socket;
  }

  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  WrappedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  WrappedWebSocket.OPEN = NativeWebSocket.OPEN;
  WrappedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  WrappedWebSocket.CLOSED = NativeWebSocket.CLOSED;

  window.WebSocket = WrappedWebSocket;
})();
