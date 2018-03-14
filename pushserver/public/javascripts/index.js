function refreshAvatars() {
  $.get('/api/v1/worldview/avatars', function(data) {
    var typeaheadSource = data.avatars.map(function(avatarObj) {
      return avatarObj.avatar;
    });
    var $avatarNameInput = $('#avatar_name');
    console.log(typeaheadSource);
    $avatarNameInput.typeahead({
      source: typeaheadSource,
      autoSelect: true,
    });
    $('#total_avatars').text(data.totalAvatars);
	switch (data.totalAvatars) {
		case 0:
			$('#avatar_login').hide();
			break;
		case 1:
			window.location = '/events/?avatar=' + data.avatars[0].avatar;
			break;
		default:
			$('#avatar_login').show();
	}

    if (typeaheadSource.length === 0) {
      $('#avatar_name').attr('disabled', 'disabled');
      $('#avatar_submit').attr('disabled', 'disabled');
      $avatarNameInput.val('');
    } else {
      $('#avatar_name').removeAttr('disabled');
      $('#avatar_submit').removeAttr('disabled');
    }
  }, 'json');
}

$(document).ready(function() {
  refreshAvatars();
  // Checks for new Avatars every 5 seconds.
  setInterval(refreshAvatars, 5000);
});
