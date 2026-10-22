import http.server
import os
import re
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().do_GET()
        if not os.path.isfile(path):
            return self.send_error(404)
        size = os.path.getsize(path)
        ctype = self.guess_type(path)
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng:
            m = re.search(r"bytes=(\d*)-(\d*)", rng)
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = int(m.group(2))
                else:
                    start = size - int(m.group(2))
                start = max(0, min(start, size - 1))
                end = max(start, min(end, size - 1))
                status = 206
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                    self.close_connection = True
                    return
                remaining -= len(chunk)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(ROOT)
    while True:
        try:
            with Server(("127.0.0.1", PORT), RangeHandler) as httpd:
                print("Sirviendo %s en http://localhost:%d" % (ROOT, PORT), flush=True)
                httpd.serve_forever()
        except KeyboardInterrupt:
            break
        except Exception as e:
            print("Reinicio tras error:", e, flush=True)
