(function() {

	var topNavBtnTrigger = document.getElementById("btn-trigger-top-nav");
	var topNavRespMenu   = document.getElementById("top-nav-responsive-menu");

	topNavBtnTrigger.addEventListener("click", function() {
		
		var activeStatus = topNavRespMenu.getAttribute("top-nav-responsive-active");

		if(activeStatus == "false") {
			topNavRespMenu.style.height = "auto";
			topNavRespMenu.setAttribute("top-nav-responsive-active", "true");
		} else {
			topNavRespMenu.style.height = "0";
			topNavRespMenu.setAttribute("top-nav-responsive-active", "false");
		}

	});

})();