#!/usr/bin/python3 -I
"""Security regressions for bin/quickmap-helper.py."""
from __future__ import annotations

import http.server
import importlib.machinery
import importlib.util
import json
import os
import socket
import stat
import tempfile
import threading
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "bin" / "quickmap-helper.py"


def load_helper():
    loader = importlib.machinery.SourceFileLoader("quickmap_helper", str(HELPER))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


mod = load_helper()


def png_chunk(tag: bytes, data: bytes) -> bytes:
    length = len(data).to_bytes(4, "big")
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return length + tag + data + crc.to_bytes(4, "big")


def make_png(width: int, height: int) -> bytes:
    sig = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    ihdr = width.to_bytes(4, "big") + height.to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    row = bytes([0]) + bytes(width * 3)
    raw = row * height
    return sig + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(raw)) + png_chunk(b"IEND", b"")


class ChunkedHandler(http.server.BaseHTTPRequestHandler):
    bodies: dict[str, bytes] = {}

    def log_message(self, format, *args):
        return

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        body = self.bodies.get(path)
        if body is None:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Content-Type", "application/octet-stream")
        self.end_headers()
        view = memoryview(body)
        size = 256
        while view:
            n = min(size, len(view))
            chunk = bytes(view[:n])
            view = view[n:]
            try:
                self.wfile.write(f"{n:x}\r\n".encode("ascii") + chunk + b"\r\n")
            except OSError:
                return
        try:
            self.wfile.write(b"0\r\n\r\n")
        except OSError:
            return


def start_server(bodies: dict[str, bytes]):
    ChunkedHandler.bodies = bodies
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), ChunkedHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class UrlTests(unittest.TestCase):
    def test_https_allowlist(self):
        self.assertTrue(mod.allowed_url("https://nominatim.openstreetmap.org/search?q=a"))
        self.assertTrue(mod.allowed_url("https://router.project-osrm.org/route/v1/driving/0,0;1,1"))
        self.assertTrue(mod.allowed_url("https://tile.openstreetmap.org/1/0/0.png"))
        self.assertTrue(mod.allowed_url("https://ipwho.is/"))
        self.assertFalse(mod.allowed_url("https://evil.example/"))
        self.assertFalse(mod.allowed_url("http://nominatim.openstreetmap.org/search"))
        self.assertFalse(mod.allowed_url("https://user:pass@nominatim.openstreetmap.org/"))
        self.assertFalse(mod.allowed_url("file:///etc/passwd"))

    def test_curl_cmd_hygiene(self):
        cmd = mod.curl_cmd("https://nominatim.openstreetmap.org/search", 1024, 8, "QuickMap/1.0")
        self.assertEqual(cmd[0], "/usr/bin/curl")
        self.assertEqual(cmd[1], "-q")
        self.assertIn("--noproxy", cmd)
        self.assertIn("--proto", cmd)
        self.assertEqual(cmd[-2], "--")
        self.assertTrue(cmd[-1].startswith("https://nominatim.openstreetmap.org/"))
        self.assertNotIn("-L", cmd)

    def test_loopback_http_requires_flag(self):
        os.environ.pop("QUICKMAP_ALLOW_LOOPBACK", None)
        self.assertFalse(mod.allowed_url("http://127.0.0.1/json"))
        os.environ["QUICKMAP_ALLOW_LOOPBACK"] = "1"
        try:
            self.assertTrue(mod.allowed_url("http://127.0.0.1/json"))
        finally:
            os.environ.pop("QUICKMAP_ALLOW_LOOPBACK", None)


class FileTrustTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        self.prev_home = os.environ.get("HOME")
        os.environ["HOME"] = str(self.home)
        os.environ.pop("XDG_CACHE_HOME", None)

    def tearDown(self):
        if self.prev_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = self.prev_home
        self.tmp.cleanup()

    def test_write_atomic_replaces_symlink_not_target(self):
        dirfd = mod.open_dir_chain(mod.cache_parts(), create=True, chmod_owned=True)
        try:
            victim = Path(self.tmp.name) / "victim"
            victim.write_text("must survive\n", encoding="utf-8")
            os.symlink(str(victim), "15-1-2.png", dir_fd=dirfd)
            png = make_png(256, 256)
            mod.write_atomic(dirfd, "15-1-2.png", png)
            self.assertEqual(victim.read_text(encoding="utf-8"), "must survive\n")
            st = os.stat("15-1-2.png", dir_fd=dirfd, follow_symlinks=False)
            self.assertTrue(stat.S_ISREG(st.st_mode))
            self.assertEqual(st.st_mode & 0o777, 0o600)
        finally:
            os.close(dirfd)

    def test_read_bounded_refuses_symlink_fifo_oversize(self):
        settings = self.home / ".local" / "state" / "omarchy" / "settings"
        settings.mkdir(parents=True)
        secret = self.home / "secret"
        secret.write_text("token", encoding="utf-8")
        link = settings / "weather.json"
        link.symlink_to(secret)
        dirfd = mod.open_dir_chain(mod.weather_parts(), create=False, chmod_owned=False)
        try:
            with self.assertRaises(PermissionError):
                mod.read_bounded(dirfd, "weather.json", 1024)
        finally:
            os.close(dirfd)
        link.unlink()
        os.mkfifo(link)
        dirfd = mod.open_dir_chain(mod.weather_parts(), create=False, chmod_owned=False)
        try:
            with self.assertRaises((PermissionError, OSError, BlockingIOError)):
                mod.read_bounded(dirfd, "weather.json", 1024)
        finally:
            os.close(dirfd)
        os.unlink(link)
        link.write_bytes(b"x" * 64)
        dirfd = mod.open_dir_chain(mod.weather_parts(), create=False, chmod_owned=False)
        try:
            with self.assertRaises(PermissionError):
                mod.read_bounded(dirfd, "weather.json", 8)
        finally:
            os.close(dirfd)

    def test_read_bounded_regular_file(self):
        settings = self.home / ".local" / "state" / "omarchy" / "settings"
        settings.mkdir(parents=True)
        (settings / "weather.json").write_text('{"latitude":1,"longitude":2}', encoding="utf-8")
        dirfd = mod.open_dir_chain(mod.weather_parts(), create=False, chmod_owned=False)
        try:
            data = mod.read_bounded(dirfd, "weather.json", 1024)
        finally:
            os.close(dirfd)
        self.assertEqual(data, b'{"latitude":1,"longitude":2}')

    def test_repair_removes_non_regular(self):
        dirfd = mod.open_dir_chain(mod.cache_parts(), create=True, chmod_owned=True)
        try:
            os.symlink("/tmp/victim", "planted.png", dir_fd=dirfd)
            regular = os.open(
                "ok.png",
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o644,
                dir_fd=dirfd,
            )
            os.write(regular, b"hi")
            os.close(regular)
            mod.repair_owned_dir(dirfd)
            names = set(mod.listdir_fd(dirfd))
            self.assertNotIn("planted.png", names)
            st = os.stat("ok.png", dir_fd=dirfd, follow_symlinks=False)
            self.assertEqual(st.st_mode & 0o777, 0o600)
        finally:
            os.close(dirfd)

    def test_cache_dir_is_0700(self):
        dirfd = mod.open_dir_chain(mod.cache_parts(), create=True, chmod_owned=True)
        try:
            st = os.fstat(dirfd)
            self.assertEqual(st.st_mode & 0o777, 0o700)
        finally:
            os.close(dirfd)

    def test_xdg_cache_outside_home_refused(self):
        os.environ["XDG_CACHE_HOME"] = "/tmp/not-home"
        with self.assertRaises(PermissionError):
            mod.cache_parts()
        os.environ.pop("XDG_CACHE_HOME", None)

    def test_tile_name_rejects_bad_values(self):
        self.assertIsNone(mod.parse_tile({"z": 1, "x": 0, "y": 0}))
        self.assertIsNone(mod.parse_tile({"z": 5, "x": -1, "y": 0}))
        self.assertIsNone(mod.parse_tile({"z": 2, "x": 99, "y": 0}))
        self.assertEqual(mod.parse_tile({"z": 2, "x": 1, "y": 1}), (2, 1, 1))


class HttpSizeTests(unittest.TestCase):
    def setUp(self):
        os.environ["QUICKMAP_ALLOW_LOOPBACK"] = "1"
        png_ok = make_png(256, 256)
        png_tiny = make_png(1, 1)
        self.server = start_server({
            "/json/ok": json.dumps([{"lat": "1", "lon": "2", "name": "A"}]).encode(),
            "/json/oversize": b"x" * (mod.MAX_SEARCH_BYTES + 4096),
            "/tile/ok/2/0/0.png": png_ok,
            "/tile/tiny/2/1/1.png": png_tiny,
            "/tile/junk/2/2/2.png": b"not-a-png-image",
            "/tile/oversize/2/3/3.png": b"z" * (mod.MAX_TILE_BYTES + 4096),
        })
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        os.environ.pop("QUICKMAP_ALLOW_LOOPBACK", None)

    def test_json_ok_and_oversize(self):
        body = mod.http_get(self.base + "/json/ok", mod.MAX_SEARCH_BYTES, 8, "QuickMap/test")
        self.assertIn(b"lat", body)
        with self.assertRaises(OSError):
            mod.http_get(self.base + "/json/oversize", mod.MAX_SEARCH_BYTES, 8, "QuickMap/test")

    def test_tile_png_and_rejects(self):
        ok = mod.http_get(self.base + "/tile/ok/2/0/0.png", mod.MAX_TILE_BYTES, 8, "QuickMap/test")
        self.assertTrue(mod.png_ok(ok))
        tiny = mod.http_get(self.base + "/tile/tiny/2/1/1.png", mod.MAX_TILE_BYTES, 8, "QuickMap/test")
        self.assertFalse(mod.png_ok(tiny))
        junk = mod.http_get(self.base + "/tile/junk/2/2/2.png", mod.MAX_TILE_BYTES, 8, "QuickMap/test")
        self.assertFalse(mod.png_ok(junk))
        with self.assertRaises(OSError):
            mod.http_get(self.base + "/tile/oversize/2/3/3.png", mod.MAX_TILE_BYTES, 8, "QuickMap/test")

    def test_no_content_length_on_oversize_fixture(self):
        with socket.create_connection(("127.0.0.1", self.server.server_port), 2) as sock:
            sock.sendall(b"GET /json/oversize HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            raw = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                raw += chunk
                if b"\r\n\r\n" in raw:
                    break
        headers = raw.split(b"\r\n\r\n", 1)[0].lower()
        self.assertNotIn(b"content-length:", headers)
        self.assertIn(b"chunked", headers)


class RouteUrlTests(unittest.TestCase):
    def test_two_points_and_via(self):
        two = mod.route_request_url("drive", [(38.9, -77.0), (38.8, -77.1)])
        self.assertIn("/route/v1/driving/", two)
        self.assertIn("-77.0,38.9;-77.1,38.8", two)
        self.assertIn("geometries=geojson", two)
        via = mod.route_request_url("walk", [(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)])
        self.assertIn("/route/v1/foot/", via)
        self.assertIn("2.0,1.0;4.0,3.0;6.0,5.0", via)

    def test_rejects_bad_counts(self):
        with self.assertRaises(ValueError):
            mod.route_request_url("drive", [(1.0, 2.0)])
        with self.assertRaises(ValueError):
            mod.route_request_url("bike", [(1.0, 2.0), (3.0, 4.0)])
        too_many = [(float(i), float(i)) for i in range(mod.MAX_ROUTE_POINTS + 1)]
        with self.assertRaises(ValueError):
            mod.route_request_url("drive", too_many)

    def test_cmd_route_arg_shape(self):
        self.assertEqual(mod.cmd_route(["drive"]), 2)
        self.assertEqual(mod.cmd_route(["drive", "1", "2", "3"]), 2)
        self.assertEqual(mod.cmd_route(["drive"] + ["0"] * (mod.MAX_ROUTE_POINTS * 2 + 2)), 2)
        self.assertEqual(mod.cmd_route(["fly", "1", "2", "3", "4"]), 2)


class PrintArgvTests(unittest.TestCase):
    def test_print_reads_stdin_not_argv(self):
        import inspect
        src = inspect.getsource(mod.cmd_print)
        self.assertIn("read_stdin_bounded", src)
        self.assertNotIn("sys.argv", src)
        self.assertIn("/usr/bin/lp", mod.LP)


if __name__ == "__main__":
    unittest.main()
