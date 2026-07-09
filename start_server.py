import http.server
import socketserver
import urllib.parse
import urllib.request
import os

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        # Decode %3F in path if present
        raw_path = self.path
        if "%3F" in raw_path or "%3f" in raw_path:
            raw_path = urllib.parse.unquote(raw_path)
            
        parsed_url = urllib.parse.urlparse(raw_path)
        
        # Intercept Netlify Image CDN requests
        if '/.netlify/images' in parsed_url.path:
            query_params = urllib.parse.parse_qs(parsed_url.query)
            target_url = query_params.get('url', [None])[0]
            if target_url:
                target_parts = list(urllib.parse.urlparse(target_url))
                target_query = urllib.parse.parse_qs(target_parts[4])
                for k, v in query_params.items():
                    if k != 'url':
                        target_query[k] = v
                target_parts[4] = urllib.parse.urlencode(target_query, doseq=True)
                redirect_url = urllib.parse.urlunparse(target_parts)
                
                print(f"  -> INTERCEPTED & REDIRECTING to: {redirect_url}")
                self.send_response(302)
                self.send_header('Location', redirect_url)
                self.end_headers()
                return

        # Proxy webgl/ requests to live site
        if '/webgl/' in parsed_url.path:
            live_url = f"https://hubtown-live.netlify.app{self.path}"
            print(f"  -> PROXYING webgl request to: {live_url}")
            try:
                # Open request to live server
                req = urllib.request.Request(live_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req) as resp:
                    self.send_response(resp.status)
                    # Copy headers
                    for header_name, header_val in resp.getheaders():
                        if header_name.lower() not in ['server', 'date', 'transfer-encoding', 'connection']:
                            self.send_header(header_name, header_val)
                    self.end_headers()
                    # Copy data
                    self.wfile.write(resp.read())
                return
            except Exception as e:
                print(f"  -> PROXY ERROR: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b"Proxy Error")
                return
        
        return super().do_GET()

handler = CustomHTTPRequestHandler
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), handler) as httpd:
    print(f"\n======================================================")
    print(f"Server running at http://localhost:{PORT}")
    print(f"======================================================")
    print(f"Fix active: Intercepting /.netlify/images requests")
    print(f"Fix active: Proxying /webgl/ requests to live site")
    print(f"Redirecting to Sanity.io CDN and live server...\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
