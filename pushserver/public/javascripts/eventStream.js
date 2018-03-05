var source = new EventSource('/events/' + avatarName + '/eventStream');

source.addEventListener('message', function(e) {
  console.log(e);
  var event = JSON.parse(e.data);
  console.log(event);
}, false);
