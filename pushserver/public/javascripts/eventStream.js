var source = new EventSource('/events/' + avatarName + '/eventStream');

source.addEventListener('message', function(e) {
  console.log(e);
  $('ul').append('<li>' + e.data + ' (message id: ' + e.lastEventId + ')</li>');
}, false);
