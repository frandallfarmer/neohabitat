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
 */


/** Web Services */
const HTTP        = require('http');
const Net         = require('net');
/** Server Send Events services */
const EventSource = require('server-send-events');
/** Object for file system */
const File       = require('fs');
/** Object for trace library - npm install winston */
const Trace		 = require('winston');

const FileList = ["first.html", "second.html", "third.html"]
var   FileNum = 0;

const WebHost = "localhost";
const WebPort = 3000;

const WebClientPage     = "webClient.html"
const WebClientPageHTML = File.readFileSync(WebClientPage).toString();
const WebClients        = {};
var   LastWebClientID   = null;

const GameHost    = "localhost";
const GamePort    = 3001;
var   GameClient  = {};


function stringifyID(socket) {
	return "" + socket.remoteAddress + "." + socket.remotePort;
}

const WebServer = HTTP.createServer(function(client) {
	LastWebClientID = stringifyID(client.socket);
    if (WebClients[LastWebClientID] == null) {
    	WebClients[LastWebClientID] = new EventSource;
    }
}).listen(WebPort, WebHost);

WebServer.on('request', (request, response) => {
	var id 			= stringifyID(request.socket);
	var eventSource = WebClients[id];
	Trace.info(id);	
    if (eventSource.match(request, '/events')) {		// Link up the event stream handler to this client.
      Trace.info("Rigged Events");
      eventSource.handle(request, response);
//   	  setInterval(() => {pushToClient(eventSource)}, 3000);			/// HACK SERVER ACTIVITY
    } else {
      Trace.info("Served page");
	  response.end(WebClientPageHTML);		// If there are no arguments, this is a web client - send the page.
	  delete WebClients[id];
    }
  });

function pushToClient(id, file, html) {
	var webClient = WebClients[id];
	var contents  = "PAGE" + file + " NOT FOUND";
//	var script    = html || FileList[FileNum];
//	FileNum = (FileNum + 1) % FileList.length;
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
		trace.error("Web Client " + id + "not found.")
	}
}

Trace.info('Push WebServer listening on ' + WebHost +':'+ WebPort);

const GameServer = Net.createServer(function (client) {
	Trace.info("Neohabitat Server has connected!")
	GameClient = client;
	// JSON based client.
	// Singleton - uses IP address? to map user sessions to web clients for pushing html files...
	Trace.info("NeoHabitat Server at " + stringifyID(client));
	client.on('data', function(data) {
		// Parse the JSON here.
		// Find the matching web session
		//pushToClient(Webclients[id])!
		var message = {};
		try {
			message = JSON.parse(data);
			Trace.info("Server -> " + JSON.stringify(message));
		} catch (err) {
			Trace.info("Did not parse, terminating connection.");
			client.end();
			return;
		}
		var file   = message.file   || "";
		var html   = message.html   || "";
		var target = message.target || LastWebClientID;
		pushToClient(target, file, html);
	});
}).listen(GamePort, GameHost);

Trace.info('Also listening for NeoHabitat server on '  + GameHost +':'+ GamePort);

