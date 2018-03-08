var CONNECTED = 'CONNECTED';
var REGION_CHANGE = 'REGION_CHANGE';

var HabiventsES = null

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

function processEvent(event) {
  switch (event.type) {
    case CONNECTED:
      return;
    case REGION_CHANGE:
      $('#avatarRegion').text(event.msg.description);
      $('#docsFrame').attr('src', event.msg.docsURL);
      $('#orientationHeader').text(event.msg.orientation);
      $("#compass").rotate({
        animateTo: orientationToRotation(event.msg.orientation),
      });
      return;
    default:
      console.log('Unknown event type: ', event.type)
      return;
  }
}

function startEventSource() {
  if (HabiventsES == null || HabiventsES.readyState == 2) {
    HabiventsES = new EventSource('/events/' + avatarName + '/eventStream');
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

function refreshAvatars() {
  $.get('/api/v1/worldview/avatars', function(data) {
    $('#totalAvatarsHeader').text(data.totalAvatars);
  }, 'json');
}

$(document).ready(function() {
  startEventSource();
  refreshAvatars();
  // Checks for new Avatars every 5 seconds.
  setInterval(refreshAvatars, 5000);
});
