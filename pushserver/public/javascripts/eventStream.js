var CONNECTED = 'CONNECTED';
var REGION_CHANGE = 'REGION_CHANGE';
var SHOW_HELP = 'SHOW_HELP';

var HabiventsES = null;
var CurrentAvatars = {};

function orientationToRotation(orientation) {
  switch (orientation) {
    case 'North':
      return 0;
    case 'West':
      return 90;
    case 'South':
      return 180;
    case 'East':
      return 270;
    default:
      return 0;
  }
}

const HTMLArrows = ['&#8593;', '&#8592;', '&#8595;', '&#8594;'];
const orient     = ["West", "East", "North", "South"];

function processEvent(event) {
  switch (event.type) {
    case CONNECTED:
      return;
    case REGION_CHANGE:
      $('#regionHeader').text(event.msg.description);
      $('#docsFrame').attr('src', event.msg.docsURL);
      $('#orientationHeader').text(event.msg.orientation);
      $("#compass").rotate({
        animateTo: orientationToRotation(event.msg.orientation),
      })
      var arrow = (orient.indexOf(event.msg.orientation) + 3) % 4;
      $("#northArrow").html(HTMLArrows[arrow]);
      $("#northHeader").text(event.msg.neighbors.North);
      arrow = ++arrow % 4;
      $("#westArrow").html(HTMLArrows[arrow]);
      $("#westHeader").text(event.msg.neighbors.West);
      arrow = ++arrow % 4;
      $("#southArrow").html(HTMLArrows[arrow]);
      $("#southHeader").text(event.msg.neighbors.South);
      arrow = ++arrow % 4;
      $("#eastArrow").html(HTMLArrows[arrow]);
      $("#eastHeader").text(event.msg.neighbors.East);
      return;
    case SHOW_HELP:
      $('#docsFrame').attr('src', event.msg.docsURL);
      return;
    default:
      console.log('Unknown event type: ', event.type)
      return;
  }
}

function startEventSource() {
  if (HabiventsES == null || HabiventsES.readyState == 2) {
    HabiventsES = new EventSource('/events/'+AvatarName+'/eventStream');
    HabiventsES.onerror = function(e) {
      if (HabiventsES.readyState == 2) {
        console.log('Habivents EventSource disconnected, retrying in 3 secs:', e);
        setTimeout(startEventSource, 3000);
      }
    }
    HabiventsES.addEventListener('message', function(e) {
      var event = JSON.parse(e.data);
      processEvent(event);
    }, false);
  }
}

function doAction(type, params) {
  var action = {
    type: type,
    params: {},
  }
  if (params !== undefined) {
    action.params = params;
  }
  $.ajax('/api/v1/avatar/'+AvatarName+'/action', {
    data: JSON.stringify(action),
    contentType: 'application/json',
    type: 'POST',
    success: function () {
      console.log('Successfully sent action:', type, params);
    },
  });
}

function startEsp(avatarName) {
  doAction('START_ESP', {avatar: avatarName});
}

function sendTeleportInvite(avatarName) {
  doAction('SEND_TELEPORT_INVITE', {avatar: avatarName});
}

function sendTeleportRequest(avatarName) {
  doAction('SEND_TELEPORT_REQUEST', {avatar: avatarName});
}

function appendButton(element, avatarName, btnClass, text, tooltip, onclick) {
  var newButton = $('<button>');
  newButton
    .attr('id', avatarName)
    .attr('onclick', onclick)
    .attr('type', 'button')
    .attr('class', 'action-button btn btn-sm btn-'+btnClass)
    .attr('data-toggle', 'tooltip')
    .attr('data-placement', 'top')
    .attr('title', tooltip)
    .text(text);
  element.append(newButton);
  newButton.tooltip({
    trigger : 'hover'
  });
}

function fillOnlineAvatarsTable(avatars) {
  var tbody = $("#onlineAvatarsTable").find('tbody');

  var newCurrentAvatars = {}
  avatars.forEach(function(avatarObj) {
    newCurrentAvatars[avatarObj.avatar] = avatarObj.location;
  })

  // Removes rows corresponding to Avatars that are no longer logged in.
  var currentAvatarNames = Object.keys(CurrentAvatars);
  currentAvatarNames.forEach(function(avatarName) {
    if (!(avatarName in newCurrentAvatars)) {
      $('#avatar-'+avatarName.hashCode()).remove();
    }
  })

  // Adds rows corresponding to Avatars that are newly logged in.
  avatars.forEach(function(avatarObj) {
    if (avatarObj.avatar in CurrentAvatars) {
      return;
    }

    var avatarRow = $('<tr>');
    avatarRow.attr('id', 'avatar-'+avatarObj.avatar.hashCode());
    avatarRow.attr('class', 'avatar-row');
    var avatarCell = $('<td>');
    
    var avatarIdentity = $('<p>');
    avatarIdentity.attr('class', 'no-margin');
    avatarIdentity.html('<b>'+avatarObj.avatar+'</b><br/>'+avatarObj.location);
    
    avatarCell.append(avatarIdentity);

    if (avatarObj.avatar !== AvatarName) {
      // appendButton(avatarCell, avatarObj.avatar,
      //   'primary start-esp', 'E', 'Start ESP',
      //   'startEsp("'+avatarObj.avatar+'")');
      appendButton(avatarCell, avatarObj.avatar,
        'info teleport-invite', 'I', 'Invite Avatar to Teleport Here',
        'sendTeleportInvite("'+avatarObj.avatar+'")');
      appendButton(avatarCell, avatarObj.avatar,
        'success teleport-request', 'R', 'Request to Join Avatar',
        'sendTeleportRequest("'+avatarObj.avatar+'")');
    }

    avatarRow.append(avatarCell);
    tbody.append(avatarRow);
  });

  CurrentAvatars = newCurrentAvatars;
}

function refreshAvatars() {
  $.get('/api/v1/worldview/avatars', function(data) {
    fillOnlineAvatarsTable(data.avatars);
  }, 'json');
}

$(document).ready(function() {
  startEventSource();

  refreshAvatars();
  setInterval(refreshAvatars, 5000 + Math.floor(Math.random() * 2000));
});
