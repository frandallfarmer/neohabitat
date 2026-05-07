var RefreshInterval = null;
var EmulatorHelpPage = '/docs/region/EMULATOR_HELP';

function supportsGamepads() {
  return false;
}

function trackAvatar(avatarName) {
  AvatarName = avatarName;
  activateDocent();
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
  $('#docsFrame').attr('src', EmulatorHelpPage);
}

function refreshAvatarButtons() {
  $.get('/api/v1/worldview/avatars', function(data) {
    var users = data.avatars.filter(function(a) {
      return a.avatar.toLowerCase().indexOf('bot') === -1;
    });
    var $controls = $('#docentControls').css('gap', '0.5rem');
    $controls.empty();
    if (users.length === 0) {
      $controls.append('<button type="button" disabled="disabled" class="btn btn-primary">Activate Docent</button>');
    } else {
      users.forEach(function(avatarObj) {
        var name = avatarObj.avatar;
        $controls.append(
          $('<button type="button" class="btn btn-success"></button>')
            .text('Track ' + name)
            .on('click', function() { trackAvatar(name); return false; })
        );
      });
    }
  }, 'json');
}

$(document).ready(function() {
  if (supportsGamepads()) {
    EmulatorHelpPage = '/docs/region/EMULATOR_HELP_JOYSTICK';
    viewHelp();
  }
  refreshAvatarButtons();
  // Checks for new avatars every 5 seconds.
  RefreshInterval = setInterval(refreshAvatarButtons, 5000);
});
