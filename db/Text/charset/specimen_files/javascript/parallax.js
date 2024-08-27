(function() {

  function elementViewportOffset(element) {
    var rect = element.getBoundingClientRect();
    var viewportHeight = Math.max(
      document.documentElement.clientHeight,
      window.innerHeight
    );
    return 1 - rect.bottom / viewportHeight;
  }
 
  var parallaxSections = document.getElementsByClassName("l-parallax");
 
  // Save each element's initial `top`
  for(var iter = 0; iter < parallaxSections.length; iter++) {
    var section = parallaxSections[iter];
    var parallaxElements = section.querySelectorAll(".l-parallax_item");
    for (var i = 0; i < parallaxElements.length; i++) {
      var element = parallaxElements[i];
      element.setAttribute("data-initial-top", element.offsetTop);
    }
  }
 
  function updatePositions() {
    for (var iter = 0; iter < parallaxSections.length; iter++) {
      var section = parallaxSections[iter];
      var offset = elementViewportOffset(section);
      if (offset > -1 && offset < 1) { // Is in the viewport
        var parallaxElements = section.querySelectorAll(".l-parallax_item");
        for (var i = 0; i < parallaxElements.length; i++) {
          var element = parallaxElements[i];
          var maxTranslate = +element.getAttribute("data-parallax-translate");
          var initialTop = +element.getAttribute("data-initial-top");
          element.style.top = (initialTop - maxTranslate * offset) + "px";
        }
      }
    }
  }
 
  window.addEventListener('scroll', updatePositions);
  updatePositions();
  
})();