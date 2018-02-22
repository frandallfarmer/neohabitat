/**
 * This server pushes HTML out to web clients that have called in using the web Server Send Events protocol (Chrome/Firefox only for now.)
 * 
 * Requires:
 * $ npm install server-send-events
 * 
 */


/** Web Services */
const http        = require('http');
/** Server Send Events services */
const EventSource = require('server-send-events');
/** Object for file system */
const File       = require('fs');
/** Object for trace library - npm install winston */
const Trace		 = require('winston');

const FileList = ["first.html", "second.html", "third.html"]
var   FileNum = 0;

const es = new EventSource();
const server = new http.Server();
const send = (res) => res.end(`<script>
  var source = new EventSource('/events');
  source.onmessage = function(e) {
    document.body.innerHTML = e.data;
    console.log(e.data);
  };
</script>`);
 
server.on('request', (req, res) => {
  if(es.match(req, '/events')){
    es.handle(req, res);
  }else{
    send(res);
  }
})
 
server.listen(3000, err => {
  if(err) throw err;
  console.log(`server-send-events is running at http://localhost:${server.address().port}`);
  setInterval(() => {
    if (es) {
    	var contents;
    	var script = FileList[FileNum];
    	FileNum = (FileNum + 1) % FileList.length;
    	try {
    		contents = File.readFileSync(script);
    	} catch (err) {
    		try {
    			contents = File.readFileSync(script + ".html");
    		} catch (err) {
    			Trace.error("Unable to read " + script + "[.html]");
    		}
    	}
    	es.send(contents.toString());
    }
  }, 3000);
});
