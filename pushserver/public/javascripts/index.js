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
  // Checks for new Avatars every 5 seconds.
  refreshAvatars();
  setInterval(refreshAvatars, 5000);
});