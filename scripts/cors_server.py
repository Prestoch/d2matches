#!/usr/bin/env python3
"""
Simple HTTP server with CORS enabled
Allows browser to fetch files from localhost
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers to allow any origin
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    port = 8888
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    
    server = HTTPServer(('', port), CORSRequestHandler)
    print(f'🌐 CORS-enabled server running on http://localhost:{port}')
    print(f'📂 Serving files from: {server.RequestHandlerClass.directory or "."}')
    print(f'Press Ctrl+C to stop\n')
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n👋 Server stopped')
        sys.exit(0)
