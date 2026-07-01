// A page may override the load/help doc (the web-client docent uses WEBCLIENT_HELP, not the
// C64-emulator instructions) by defining DocentHelpPage before this script loads.
var EmulatorHelpPage = (typeof DocentHelpPage !== 'undefined' && DocentHelpPage)
  || '/docs/region/EMULATOR_HELP';

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
