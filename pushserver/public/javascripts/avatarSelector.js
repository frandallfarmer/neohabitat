var EmulatorHelpPage = '/docs/region/EMULATOR_HELP';

function supportsGamepads() {
  return false;
}

function trackAvatar(avatarName) {
  if (AvatarName === avatarName) {
    return;
  }
  AvatarName = avatarName;
  activateDocent();
}

function activateDocent() {
  startEventSource();
  $('#avatarHeader').text(AvatarName);
  $('.login-panel').addClass('d-none');
  $('.status-panel').addClass('d-flex');
  $('.status-panel').removeClass('d-none');
}

function viewHelp() {
  $('#docsFrame').attr('src', EmulatorHelpPage);
}

$(document).ready(function() {
  if (supportsGamepads()) {
    EmulatorHelpPage = '/docs/region/EMULATOR_HELP_JOYSTICK';
    viewHelp();
  }
});
