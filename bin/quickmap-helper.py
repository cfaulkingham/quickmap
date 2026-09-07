#!/usr/bin/python3 -I
"""Bounded OSM fetches and cache I/O for QuickMap.

Invoked as an argv array from QML:
  /usr/bin/python3 -I -S bin/quickmap-helper.py <verb> [-- args]
Verbs: search, route, ip, tiles, print, weather.
Payloads that must not appear in argv travel on stdin.
"""
from __future__ import annotations

import json
import os
import select
import signal
import stat
import subprocess
import sys
import threading
import time
import urllib.parse

CURL = "/usr/bin/curl"
LP = "/usr/bin/lp"
LPSTAT = "/usr/bin/lpstat"

USER_AGENT = "QuickMap/1.0 (io.github.cfaulkingham.quickmap; colin.faulkingham@gmail.com)"
ANON_USER_AGENT = "QuickMap/1.0 (io.github.cfaulkingham.quickmap)"

MAX_SEARCH_BYTES = 64 * 1024
MAX_ROUTE_BYTES = 256 * 1024
MAX_LOCATION_BYTES = 16 * 1024
MAX_TILE_BYTES = 256 * 1024
MAX_PRINT_BYTES = 64 * 1024
MAX_WEATHER_BYTES = 16 * 1024
MAX_TILE_JSON_BYTES = 32 * 1024
MAX_QUERY_BYTES = 200
MAX_STDERR = 4096
MAX_TILES = 220
MAX_TILE_JOBS = 2
MAX_VIAS = 8
MAX_ROUTE_POINTS = MAX_VIAS + 2
HTTP_TIMEOUT_SEC = 8
CONNECT_TIMEOUT_SEC = 5
SEARCH_DEADLINE_SEC = 15
ROUTE_DEADLINE_SEC = 20
IP_DEADLINE_SEC = 12
TILE_DEADLINE_SEC = 90
PRINT_DEADLINE_SEC = 20
WEATHER_DEADLINE_SEC = 5
STDIN_WAIT_SEC = 8
TILE_SIZE = 256
MIN_ZOOM = 2
MAX_ZOOM = 18
PNG_SIG = b"\x89PNG\r\n\x1a\n"

NOMINATIM = "https://nominatim.openstreetmap.org/search"
OSRM_DRIVE = "https://router.project-osrm.org/route/v1/driving"
OSRM_WALK = "https://routing.openstreetmap.de/routed-foot/route/v1/foot"
IPWHO = "https://ipwho.is/"
TILE_HOST = "tile.openstreetmap.org"
ALLOWED_HTTPS_HOSTS = frozenset({
    "nominatim.openstreetmap.org",
    "router.project-osrm.org",
    "routing.openstreetmap.de",
    "ipwho.is",
    TILE_HOST,
    "www.openstreetmap.org",
})

def child_env() -> dict[str, str]:
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": os.environ.get("HOME", ""),
        "USER": os.environ.get("USER", ""),
        "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""),
        "XDG_CACHE_HOME": os.environ.get("XDG_CACHE_HOME", ""),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        "LC_ALL": "C.UTF-8",
    }

_CHILDREN: set[subprocess.Popen] = set()
_CHILDREN_LOCK = threading.Lock()
_STOP = threading.Event()


def _die(code: int = 1) -> None:
    _stop_children()
    os._exit(code)


def _on_signal(signum, frame) -> None:
    _die(1)


def _install_signals() -> None:
    try:
        os.setsid()
    except OSError:
        pass
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)


def _stop_children() -> None:
    _STOP.set()
    with _CHILDREN_LOCK:
        procs = list(_CHILDREN)
    for proc in procs:
        try:
            proc.terminate()
        except OSError:
            pass
    deadline = time.monotonic() + 2
    for proc in procs:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            proc.wait(timeout=remaining)
        except Exception:
            pass
    for proc in procs:
        if proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass
            try:
                proc.wait(timeout=1)
            except Exception:
                pass


def allowed_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    if parsed.scheme != "https":
        if parsed.scheme == "http" and (parsed.hostname or "") in ("127.0.0.1", "::1"):
            return os.environ.get("QUICKMAP_ALLOW_LOOPBACK") == "1"
        return False
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_HTTPS_HOSTS:
        return False
    if parsed.port not in (None, 443):
        return False
    return True


def curl_cmd(url: str, limit: int, timeout: int, ua: str) -> list[str]:
    if not allowed_url(url):
        raise ValueError("url not allowed")
    if limit < 1 or timeout < 1:
        raise ValueError("invalid limit or timeout")
    cmd = [
        CURL, "-q", "--fail", "--silent", "--show-error",
        "--max-time", str(timeout),
        "--connect-timeout", str(CONNECT_TIMEOUT_SEC),
        "--max-filesize", str(limit),
        "--noproxy", "*",
        "-A", ua,
    ]
    if url.startswith("https://"):
        cmd.extend(["--proto", "=https", "--proto-redir", "=https"])
    else:
        cmd.extend(["--proto", "=http", "--proto-redir", "=http"])
    cmd.extend(["--", url])
    return cmd


def run_capped(
    cmd: list[str],
    limit: int,
    timeout: float,
    stdin_data: bytes | None = None,
) -> tuple[int, bytes, bytes]:
    if not cmd or not os.path.isabs(cmd[0]):
        raise ValueError("command must be an absolute path")
    if cmd[0] not in (CURL, LP, LPSTAT):
        raise ValueError("command not allowed")
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE if stdin_data is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=child_env(),
        start_new_session=False,
    )
    with _CHILDREN_LOCK:
        _CHILDREN.add(proc)
    stdout = bytearray()
    stderr = bytearray()
    over = False
    try:
        if stdin_data is not None and proc.stdin is not None:
            view = memoryview(stdin_data)
            while view:
                n = proc.stdin.write(view)
                view = view[n:]
            proc.stdin.close()
        deadline = time.monotonic() + timeout
        streams = [proc.stdout, proc.stderr]
        while streams:
            if _STOP.is_set():
                over = True
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                over = True
                break
            ready, _, _ = select.select(streams, [], [], remaining)
            if not ready:
                over = True
                break
            for stream in ready:
                want = limit + 1 - len(stdout) if stream is proc.stdout else MAX_STDERR + 1 - len(stderr)
                if want <= 0:
                    over = True
                    streams = []
                    break
                chunk = stream.read1(min(65536, want)) if hasattr(stream, "read1") else stream.read(min(65536, want))
                if not chunk:
                    streams.remove(stream)
                    continue
                if stream is proc.stdout:
                    stdout.extend(chunk)
                    if len(stdout) > limit:
                        over = True
                        streams = []
                        break
                else:
                    stderr.extend(chunk)
                    if len(stderr) > MAX_STDERR:
                        stderr[:] = stderr[:MAX_STDERR]
                        streams.remove(stream)
        if over:
            try:
                proc.terminate()
            except OSError:
                pass
            try:
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except OSError:
                    pass
                try:
                    proc.wait(timeout=1)
                except Exception:
                    pass
            return 1, b"", bytes(stderr)
        code = proc.wait(timeout=1)
        if len(stdout) > limit:
            return 1, b"", bytes(stderr)
        return int(code if code is not None else 1), bytes(stdout), bytes(stderr)
    finally:
        with _CHILDREN_LOCK:
            _CHILDREN.discard(proc)
        if proc.poll() is None:
            try:
                proc.kill()
            except OSError:
                pass
            try:
                proc.wait(timeout=1)
            except Exception:
                pass
        for stream in (proc.stdout, proc.stderr, proc.stdin):
            if stream is None:
                continue
            try:
                stream.close()
            except OSError:
                pass


def http_get(url: str, limit: int, timeout: int, ua: str) -> bytes:
    cmd = curl_cmd(url, limit, timeout, ua)
    code, body, _err = run_capped(cmd, limit, timeout + 2)
    if code != 0 or len(body) > limit:
        raise OSError("fetch failed")
    return body


def read_stdin_bounded(limit: int, wait: float = STDIN_WAIT_SEC, idle: float = 0.3) -> bytes:
    fd = sys.stdin.fileno()
    os.set_blocking(fd, False)
    data = bytearray()
    deadline = time.monotonic() + wait
    got = False
    while time.monotonic() < deadline and len(data) <= limit:
        remaining = deadline - time.monotonic()
        timeout = min(idle if got else remaining, remaining)
        if timeout < 0:
            break
        ready, _, _ = select.select([fd], [], [], timeout)
        if not ready:
            if got:
                break
            continue
        chunk = os.read(fd, min(65536, limit + 1 - len(data)))
        if not chunk:
            break
        got = True
        data.extend(chunk)
        if len(data) > limit:
            break
    if len(data) > limit:
        raise OSError("stdin too large")
    return bytes(data)


def _passwd_home() -> str:
    home = os.path.expanduser("~")
    if not home or not os.path.isabs(home):
        raise PermissionError("no home directory")
    return os.path.abspath(home)


def open_home() -> int:
    home = _passwd_home()
    fd = os.open(home, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        st = os.fstat(fd)
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid():
            raise PermissionError("untrusted home directory")
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_dir_chain(parts: list[str], *, create: bool, chmod_owned: bool) -> int:
    for name in parts:
        if not name or name in (".", "..") or "/" in name or "\x00" in name:
            raise PermissionError("invalid directory component")
    fd = open_home()
    try:
        last = len(parts)
        for i, name in enumerate(parts, 1):
            owned = chmod_owned and i > last - 2
            try:
                nfd = os.open(
                    name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=fd,
                )
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(name, 0o700, dir_fd=fd)
                nfd = os.open(
                    name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=fd,
                )
            os.close(fd)
            fd = nfd
            st = os.fstat(fd)
            if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid():
                raise PermissionError(f"untrusted directory component {name}")
            if owned and st.st_mode & 0o077:
                os.fchmod(fd, 0o700)
        return fd
    except BaseException:
        os.close(fd)
        raise


def cache_parts() -> list[str]:
    home = _passwd_home()
    xdg = os.environ.get("XDG_CACHE_HOME") or ""
    if xdg:
        xdg = os.path.abspath(xdg)
        if xdg == home or not xdg.startswith(home + os.sep):
            raise PermissionError("XDG_CACHE_HOME is outside home")
        rel = os.path.relpath(xdg, home)
        parts = [p for p in rel.split(os.sep) if p and p != "."]
        if any(p == ".." for p in parts):
            raise PermissionError("XDG_CACHE_HOME escapes home")
        return parts + ["quickmap", "tiles"]
    return [".cache", "quickmap", "tiles"]


def weather_parts() -> list[str]:
    return [".local", "state", "omarchy", "settings"]


def listdir_fd(dirfd: int) -> list[str]:
    try:
        return os.listdir(dirfd)
    except TypeError:
        return os.listdir(f"/proc/self/fd/{dirfd}")


def _rm_tree(dirfd: int, name: str, depth: int) -> None:
    if depth > 3:
        raise PermissionError("tree too deep")
    st = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    if stat.S_ISLNK(st.st_mode) or stat.S_ISREG(st.st_mode):
        os.unlink(name, dir_fd=dirfd)
        return
    if not stat.S_ISDIR(st.st_mode):
        os.unlink(name, dir_fd=dirfd)
        return
    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dirfd)
    try:
        names = listdir_fd(child)
        if len(names) > 64:
            raise PermissionError("directory too large to remove")
        for entry in names:
            if entry in (".", ".."):
                continue
            _rm_tree(child, entry, depth + 1)
    finally:
        os.close(child)
    os.rmdir(name, dir_fd=dirfd)


def repair_owned_dir(dirfd: int) -> None:
    names = listdir_fd(dirfd)
    for name in names:
        if name in (".", ".."):
            continue
        try:
            st = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        except OSError:
            continue
        if not stat.S_ISREG(st.st_mode):
            try:
                _rm_tree(dirfd, name, 0)
            except OSError:
                pass
            continue
        if st.st_mode & 0o077:
            try:
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dirfd)
            except OSError:
                continue
            try:
                os.fchmod(fd, 0o600)
            finally:
                os.close(fd)


def read_bounded(dirfd: int, name: str, limit: int) -> bytes | None:
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        raise PermissionError("invalid file name")
    try:
        fd = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
            dir_fd=dirfd,
        )
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise PermissionError("refusing state file") from exc
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1:
            raise PermissionError("refusing state file")
        if st.st_size > limit:
            raise PermissionError("state file too large")
        os.set_blocking(fd, True)
        data = bytearray()
        while len(data) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        if len(data) > limit:
            raise PermissionError("state file grew past the limit")
        return bytes(data)
    finally:
        os.close(fd)


def write_atomic(dirfd: int, name: str, data: bytes) -> None:
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        raise PermissionError("invalid file name")
    if len(data) > MAX_TILE_BYTES:
        raise ValueError("payload too large")
    tmp = f".{name}.{os.urandom(8).hex()}.tmp"
    fd = os.open(
        tmp,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
        dir_fd=dirfd,
    )
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]
        os.fsync(fd)
        os.rename(tmp, name, src_dir_fd=dirfd, dst_dir_fd=dirfd)
        os.fsync(dirfd)
        tmp = ""
    finally:
        os.close(fd)
        if tmp:
            try:
                os.unlink(tmp, dir_fd=dirfd)
            except OSError:
                pass


def png_ok(buf: bytes) -> bool:
    if len(buf) < 24 or buf[:8] != PNG_SIG or buf[12:16] != b"IHDR":
        return False
    width = int.from_bytes(buf[16:20], "big")
    height = int.from_bytes(buf[20:24], "big")
    return width == TILE_SIZE and height == TILE_SIZE


def usable_tile(dirfd: int, name: str) -> bool:
    try:
        fd = os.open(
            name,
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
            dir_fd=dirfd,
        )
    except OSError:
        return False
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1:
            return False
        if st.st_size < 24 or st.st_size > MAX_TILE_BYTES:
            return False
        os.set_blocking(fd, True)
        data = bytearray()
        while len(data) <= MAX_TILE_BYTES:
            chunk = os.read(fd, min(65536, MAX_TILE_BYTES + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        return len(data) <= MAX_TILE_BYTES and png_ok(bytes(data))
    finally:
        os.close(fd)


def tile_name(z: int, x: int, y: int) -> str:
    return f"{z}-{x}-{y}.png"


def parse_tile(obj: object) -> tuple[int, int, int] | None:
    if not isinstance(obj, dict):
        return None
    try:
        z = int(obj["z"])
        x = int(obj["x"])
        y = int(obj["y"])
    except (KeyError, TypeError, ValueError):
        return None
    if z < MIN_ZOOM or z > MAX_ZOOM or x < 0 or y < 0:
        return None
    n = 1 << z
    if x >= n or y >= n:
        return None
    return z, x, y


def tile_url(z: int, x: int, y: int, base: str | None = None) -> str:
    if base:
        root = str(base).rstrip("/")
        return f"{root}/{z}/{x}/{y}.png"
    return f"https://{TILE_HOST}/{z}/{x}/{y}.png"


def cmd_search() -> int:
    raw = read_stdin_bounded(MAX_QUERY_BYTES)
    query = raw.decode("utf-8", "strict").strip()
    if not query or len(query.encode("utf-8")) > MAX_QUERY_BYTES:
        return 1
    url = NOMINATIM + "?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "limit": "5"}
    )
    body = http_get(url, MAX_SEARCH_BYTES, min(HTTP_TIMEOUT_SEC, SEARCH_DEADLINE_SEC), USER_AGENT)
    sys.stdout.buffer.write(body)
    return 0


def _finite_coord(text: str, lo: float, hi: float) -> float:
    value = float(text)
    if not (value == value) or value in (float("inf"), float("-inf")):
        raise ValueError("non-finite")
    if value < lo or value > hi:
        raise ValueError("out of range")
    return value


def route_request_url(mode: str, coords: list[tuple[float, float]]) -> str:
    if mode not in ("drive", "walk"):
        raise ValueError("invalid mode")
    if len(coords) < 2 or len(coords) > MAX_ROUTE_POINTS:
        raise ValueError("invalid waypoint count")
    base = OSRM_WALK if mode == "walk" else OSRM_DRIVE
    parts = ";".join(f"{lon},{lat}" for lat, lon in coords)
    return f"{base}/{parts}?overview=simplified&geometries=geojson&steps=true"


def cmd_route(argv: list[str]) -> int:
    if len(argv) < 5 or (len(argv) - 1) % 2 != 0:
        return 2
    mode = argv[0]
    if mode not in ("drive", "walk"):
        return 2
    rest = argv[1:]
    npoints = len(rest) // 2
    if npoints < 2 or npoints > MAX_ROUTE_POINTS:
        return 2
    coords: list[tuple[float, float]] = []
    for i in range(0, len(rest), 2):
        lat = _finite_coord(rest[i], -90, 90)
        lon = _finite_coord(rest[i + 1], -180, 180)
        coords.append((lat, lon))
    url = route_request_url(mode, coords)
    body = http_get(url, MAX_ROUTE_BYTES, min(HTTP_TIMEOUT_SEC, ROUTE_DEADLINE_SEC), USER_AGENT)
    sys.stdout.buffer.write(body)
    return 0


def cmd_ip() -> int:
    body = http_get(IPWHO, MAX_LOCATION_BYTES, min(HTTP_TIMEOUT_SEC, IP_DEADLINE_SEC), ANON_USER_AGENT)
    sys.stdout.buffer.write(body)
    return 0


def cmd_weather() -> int:
    dirfd = open_dir_chain(weather_parts(), create=False, chmod_owned=False)
    try:
        raw = read_bounded(dirfd, "weather.json", MAX_WEATHER_BYTES)
    finally:
        os.close(dirfd)
    if raw:
        sys.stdout.buffer.write(raw)
    return 0


def cmd_print() -> int:
    text = read_stdin_bounded(MAX_PRINT_BYTES)
    if not text:
        return 1
    runtime = os.environ.get("XDG_RUNTIME_DIR") or ""
    if not runtime:
        sys.stdout.buffer.write(b"NO_PRINTER\n")
        return 2
    code, out, err = run_capped([LPSTAT, "-d"], 4096, 5)
    info = (out + err).lower()
    if (
        code != 0
        or b"no system default" in info
        or b"no destinations" in info
        or b"unknown destination" in info
    ):
        sys.stdout.buffer.write(b"NO_PRINTER\n")
        return 2
    code, out, err = run_capped([LP], 4096, PRINT_DEADLINE_SEC, stdin_data=text)
    if code != 0:
        msg = (err or out or b"PRINT_FAILED").strip() or b"PRINT_FAILED"
        sys.stdout.buffer.write(msg[:256] + b"\n")
        return 1
    sys.stdout.buffer.write(b"PRINTED\n")
    return 0


def _fetch_tile(dirfd: int, z: int, x: int, y: int, ua: str, base: str | None) -> bool:
    name = tile_name(z, x, y)
    if usable_tile(dirfd, name):
        return False
    url = tile_url(z, x, y, base)
    body = http_get(url, MAX_TILE_BYTES, HTTP_TIMEOUT_SEC, ua)
    if not png_ok(body):
        raise OSError("invalid tile")
    write_atomic(dirfd, name, body)
    return True


def cmd_tiles(base: str | None = None) -> int:
    raw = read_stdin_bounded(MAX_TILE_JSON_BYTES)
    try:
        data = json.loads(raw.decode("utf-8", "strict") or "[]")
    except (UnicodeError, json.JSONDecodeError):
        return 1
    if not isinstance(data, list) or len(data) > MAX_TILES:
        return 1
    tiles: list[tuple[int, int, int]] = []
    seen: set[tuple[int, int, int]] = set()
    for row in data:
        parsed = parse_tile(row)
        if parsed is None:
            return 1
        if parsed in seen:
            continue
        seen.add(parsed)
        tiles.append(parsed)
    dirfd = open_dir_chain(cache_parts(), create=True, chmod_owned=True)
    try:
        repair_owned_dir(dirfd)
        miss = False
        errors: list[BaseException] = []
        lock = threading.Lock()
        deadline = time.monotonic() + TILE_DEADLINE_SEC

        def worker(tile: tuple[int, int, int]) -> None:
            nonlocal miss
            if _STOP.is_set() or time.monotonic() > deadline:
                return
            try:
                wrote = _fetch_tile(dirfd, tile[0], tile[1], tile[2], USER_AGENT, base)
                if wrote:
                    with lock:
                        miss = True
            except BaseException as exc:
                with lock:
                    errors.append(exc)

        idx = 0
        while idx < len(tiles):
            if _STOP.is_set() or time.monotonic() > deadline:
                return 1
            batch = tiles[idx:idx + MAX_TILE_JOBS]
            idx += MAX_TILE_JOBS
            threads = [threading.Thread(target=worker, args=(tile,), daemon=True) for tile in batch]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=HTTP_TIMEOUT_SEC + 3)
        if errors:
            return 1
        sys.stdout.buffer.write(b"1\n" if miss else b"0\n")
        return 0
    finally:
        os.close(dirfd)


def main(argv: list[str]) -> int:
    _install_signals()
    if not argv:
        return 2
    verb = argv[0]
    rest = argv[1:]
    if rest[:1] == ["--"]:
        rest = rest[1:]
    try:
        if verb == "search" and not rest:
            return cmd_search()
        if verb == "route":
            return cmd_route(rest)
        if verb == "ip" and not rest:
            return cmd_ip()
        if verb == "weather" and not rest:
            return cmd_weather()
        if verb == "print" and not rest:
            return cmd_print()
        if verb == "tiles" and not rest:
            return cmd_tiles()
        return 2
    except FileNotFoundError:
        return 0 if verb == "weather" else 1
    except (OSError, ValueError, PermissionError, UnicodeError):
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
