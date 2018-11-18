var RefreshInterval = null;

function selectAvatar(avatarName) {
  AvatarName = avatarName;
  $('#avatarMenuButton').text(avatarName);
}

function activateDocent() {
  startEventSource();
  $('#avatarHeader').text(AvatarName);
  $('.login-panel').addClass('d-none');
  $('.status-panel').addClass('d-flex');
  $('.status-panel').removeClass('d-none');
  clearInterval(RefreshInterval);
}

function viewHelp() {
  $('#docsFrame').attr('src', '/docs/region/EMULATOR_HELP');
}

function refreshAvatarDropdown() {
  $.get('/api/v1/worldview/avatars', function(data) {
    $('#avatarMenu').empty();
    data.avatars.forEach(function(avatarObj) {
      $('#avatarMenu').append(
        $('<a class="dropdown-item" href="#" onclick="{0}">{1}</a>'.format(
          "selectAvatar('{0}'); return false;".format(avatarObj.avatar),
          avatarObj.avatar,
        ))
      );
    });
    if (data.avatars.length === 0) {
      $('#avatarSubmit').attr('disabled', 'disabled');
      $('#avatarMenuButton').attr('disabled', 'disabled');
    } else {
      $('#avatarSubmit').removeAttr('disabled');
      $('#avatarMenuButton').removeAttr('disabled');
    }
  }, 'json');
}

$(document).ready(function() {
  refreshAvatarDropdown();
  // Checks for new Avatars every 5 seconds.
  RefreshInterval = setInterval(refreshAvatarDropdown, 5000);
});
