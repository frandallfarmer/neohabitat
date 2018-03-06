var source = new EventSource('/events/' + avatarName + '/eventStream');

source.addEventListener('message', function(e) {
  var event = JSON.parse(e.data);
  console.log(event);
}, false);
