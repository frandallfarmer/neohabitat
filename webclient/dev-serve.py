#!/usr/bin/env python3
# No-cache static server for webclient dev. Plain `python3 -m http.server` lets the browser
# cache ES modules, so edits to lib/*.js or habirender/*.js can silently keep running stale
# code. This sends Cache-Control: no-store on everything, so every reload re-fetches.
#
# Run from the repo root so sibling libs resolve (../habiworld, ../habisound, etc.):
#     cd ~/neohabitat && python3 webclient/dev-serve.py [port]   # default 8000
# then open http://localhost:8000/webclient/live.html
import http.server, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"webclient dev server (no-store) on http://localhost:{PORT}/  (serving {sys.argv[0].rsplit('/',2)[0] or '.'} cwd)")
    httpd.serve_forever()
