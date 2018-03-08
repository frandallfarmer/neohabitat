var CONNECTED = 'CONNECTED';
var REGION_CHANGE = 'REGION_CHANGE';

var HabiventsES = null

function processEvent(event) {
  switch (event.type) {
    case CONNECTED:
      return;
    case REGION_CHANGE:
      $('#avatarRegion').text(event.msg.description);
      $('#docsFrame').attr('src', event.msg.docsURL);
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

$(document).ready(function() {
  startEventSource();
})
