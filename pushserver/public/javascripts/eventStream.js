var source = new EventSource('/events/' + avatarName + '/eventStream');

var REGION_CHANGE = 'REGION_CHANGE';

function processEvent(event) {
  console.log(event);
  switch (event.type) {
    case REGION_CHANGE:
      $('#avatarRegion').text(event.msg.description);
      $('#docsFrame').attr('src', event.msg.docsURL);
    default:
      console.log('Unknown event type: ', event.type)
  }
}

source.addEventListener('message', function(e) {
  var event = JSON.parse(e.data);
  processEvent(event);
}, false);
