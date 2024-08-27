(function() {
	var btnSwitchColor = document.getElementsByClassName("fs-section_color_button");
	var boxSwitchColor = document.getElementsByClassName("fs-section_switch-color-box")[0];

	for(var i = 0; i < btnSwitchColor.length; i++) {
		btnSwitchColor[i].addEventListener("click", function() {
			var colorOne = this.getAttribute("data-color-one");
			var colorTwo = this.getAttribute("data-color-two");
			var fontColor = this.getAttribute("data-font-color");
			boxSwitchColor.style.cssText = "background: linear-gradient(135deg, "+colorOne+" 0%, "+colorTwo+" 100%)";

			// Add color to the font
			var fontColorSwitchBox = document.getElementsByClassName("fs-switch-box_font-color");
			for(var j = 0; j < fontColorSwitchBox.length; j++) {
				fontColorSwitchBox[j].style.cssText = "color:" + fontColor + " !important";
			}
		})
	}

})();