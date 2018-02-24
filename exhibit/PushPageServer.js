/**
 * This server pushes HTML out to web clients that have called in using the web Server Send Events protocol (Chrome/Firefox only for now.)
 * 
 * Two different kinds of clients connect to this server - Web clients (whom we are pushing HTML to) 
 * and a NeoHabitat server, who is choosing what to send to which web clients. 
 * 
 * 
 * Requires:
 * $ npm install server-send-events
 * 
 * 
 * Web clients connect to the public port, and are initially configured anonymously, awaiting a message from the server to identify themselves (from a pick list.)
 * Selecting their avatar name from this list refreshes the page with a query argument: ?target=username which is then used to connect up the Game and Web clients. 
 * 
 */


/** Web Services */
const HTTP     = require('http');
const Net      = require('net');
const URL      = require('url');

/** Server Send Events services */
const EventSource = require('server-send-events');
/** Object for file system */
const File       = require('fs');
/** Object for trace library - npm install winston */
const Trace		 = require('winston');

const WebHost = "localhost";
const WebPort = 3000;

const WebClientPage     = "webClient.html"
const WebClientPageHTML = File.readFileSync(WebClientPage).toString();
const WebClients        = {};
const WebClientUsers    = {};
var   SavedMessage      = {};

const GameHost    = "localhost";
const GamePort    = 3001;

function stringifyID(socket) {
	return "" + socket.remoteAddress + "." + socket.remotePort;
}

const WebServer = HTTP.createServer(function(client) {
	var ip = stringifyID(client.socket);
	if (WebClients[ip] == null) {
		WebClients[ip]    = new EventSource;
		WebClients[ip].ip = ip;
	}

	client.removeAllListeners('close').on('close', function (data) {
		Trace.info("closing connection");				// Clean up arrays holding client connection state.
		if (WebClients[ip]) {
			delete WebClients[ip];
		}
		for (var key in WebClientUsers) {
			if (WebClientUsers[key].ip == ip) {
				delete WebClientUsers[key];
			}
		}
	});
}).listen(WebPort, WebHost);

WebServer.on('request', (request, response) => {
	var ip        = stringifyID(request.socket);
	var target    = URL.parse(request.url, true).query.target;
	var webClient = WebClients[ip];
	Trace.info(ip);

	if (webClient.match(request, '/events')) {		// Link up the event stream handler to this client.
		// See if there is an already registered Web Client User connection, of if we need to convert an anonymous connection into a User connection.
		if (target) {
			if (WebClientUsers[target]) {
				webClient = WebClientUsers[target];
			} else {
				WebClientUsers[target] = webClient;
				delete WebClients[ip];
			}
			Trace.info(target + "'s web client can now recieve targeted html content.")
		} else {
			Trace.info("New web client is listening, but doesn't have a Habitat user session attached. " + ip);
		}
		webClient.handle(request, response);
		if (target && SavedMessage[target]) {
			var m = SavedMessage[target];
			pushToClient(webClient, m.file, m.html);
//			delete SavedMessage[target];
		}
	} else {
		Trace.info("Served page");
		response.end(WebClientPageHTML);		// If there are no arguments, this is a web client - send the page.
		delete WebClients[ip];
	}
});

function pushToClient(webClient, file, html) {
	var contents  = "PAGE" + file + " NOT FOUND";
	if (file && file != "") {
		try {
			contents = File.readFileSync(file).toString();
		} catch (err) {
			try {
				contents = File.readFileSync(file + ".html").toString();
			} catch (err) {
				Trace.error("Unable to read " + script + "[.html]");
			}
		}
	} else if (html && html != "") {
		contents = html;
	}
	if (webClient) {
		webClient.send(contents);
	} else {
		Trace.error("Missing client connection.");
	}
}

Trace.info('Push WebServer listening on ' + WebHost +':'+ WebPort);

/**
 * JSON based client connection, expected to be the NeoHabitat server, but that is not a requirement.
 * 
 * The arguments of the message define the behavior:
 * 
 * file: File name to be loaded and sent as a single string to the web client
 * html: Raw html string to be displayed on the web client (exclusive with file:)
 * target: the identity of the target client(s).
 * 
 * OR
 * 
 * users: an array of users currently connected, sent whenever that changes
 *        this allows this server to 1) cleanup and 2) generate a prompt to link sessions.
 * 
 * 
 */

var GameUsers = [];

function buildUsersPrompt() {
	var prompt = "";
	
	prompt = '<font size="+3">Which is your avatar?</p><ol>';
	for (user in GameUsers) {
		target = GameUsers[user];
		if (!WebClientUsers[target]) {
			prompt += '<li>';		
			prompt += '<a target="_parent" href="?target=' + target + '">';
			prompt += target;
			prompt += '</a></li>';
		}
	}
	prompt += '</ol></font>';
	return prompt;
}

const GameServer = Net.createServer(function (client) {
	Trace.info("NeoHabitat Server at " + stringifyID(client));
	client.on('data', function(data) {
		var message = {};
		try {
			message = JSON.parse(data);
			Trace.info("Server -> " + JSON.stringify(message));
		} catch (err) {
			Trace.info("Did not parse, terminating connection.");
			client.end();
			return;
		}
		if (message.users) {
			GameUsers = message.users;
			Trace.info(JSON.stringify(GameUsers));
			for (target in WebClientUsers) {
				if (!GameUsers.includes(target)) { // If a game user went away, we need to clean up.
					pushToClient(WebClientUsers[target], "", '$window.top.location.href = "";');
				}
			}
		} else {
			var file   = message.file   || "";
			var html   = message.html   || "";
			var target = message.target || "";

			var webClient;					// Grab any unknown client. Consider grabbing all of them!

			if (target == "") {									// TODO Remove this default. It's wrong. Must have target?
				if (Object.keys(WebClients).length == 0) {
					Trace.error("No target specified, and no clients connected");
					return;
				} else {
					webClient = WebClients.keys[0];					// Grab any unknown client. Consider grabbing all of them!
					pushToClient(webClient, file, html);
				}
			} else {
				webClient = WebClientUsers[target];
				SavedMessage[target] = {"target":target, "html":html, "file":file };	// Cache this if we don't have a link, or for later after a refresh.
				if (webClient) {
					pushToClient(webClient, file, html);			// We have already linked the user and the web session...
				} else {
					// Need to link the user to the web session - so we ask the web session to self-identify.
					var html = "";
					if (Object.keys(WebClients).length == 1) {
						html = '$window.top.location.href = "?target=' + target + '";';
					} else {
						html = buildUsersPrompt();
					}
					for (var anonymousID in WebClients) {
						pushToClient(WebClients[anonymousID], "", html);
					}
				}
			}
		}
	});
}).listen(GamePort, GameHost);

Trace.info('Also listening for NeoHabitat server on '  + GameHost +':'+ GamePort);

