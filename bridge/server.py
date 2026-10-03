"""Serve the game and a bounded, read-only view of fixed local services.

Run from the repository root: python -m bridge.server [--connect-local]
No upstream request is made unless --connect-local is explicitly supplied.
"""
from __future__ import annotations

import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import re
import socket
import threading
import time
from types import MappingProxyType
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent.parent
SCHEMA_VERSION = 1
MAX_PROJECTS = 64
MAX_DEPENDENCIES = 16
MAX_STATIC_BYTES = 8 * 1024 * 1024
TIMEOUT_SECONDS = 3.0
CACHE_SECONDS = 5.0


@dataclass(frozen=True)
class Endpoint:
    port: int
    path: str
    max_bytes: int


# Fixed example-contract allowlist. Never derive a target from a request, registry URL,
# environment variable, browser header, or upstream response.
ENDPOINTS = MappingProxyType({
    "projects": Endpoint(8770, "/api/projects", 512 * 1024),
    "health": Endpoint(8770, "/api/health", 128 * 1024),
    "local-runtime": Endpoint(8000, "/api/state", 128 * 1024),
})


class UpstreamError(Exception):
    """Safe, fixed error code; never includes response bodies or credentials."""

    def __init__(self, code: str, http_status: int | None = None):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _reject_constant(_value):
    raise ValueError("Non-finite JSON number")


def fetch_json(key: str) -> dict:
    """GET one named endpoint with fresh headers, no redirects or proxy use."""
    if key not in ENDPOINTS:
        raise UpstreamError("endpoint-not-allowed")
    target = ENDPOINTS[key]
    connection = http.client.HTTPConnection("127.0.0.1", target.port, timeout=TIMEOUT_SECONDS)
    timed_out = threading.Event()
    sockets = []

    def expire():
        timed_out.set()
        sock = sockets[0] if sockets else connection.sock
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        connection.close()

    deadline = threading.Timer(TIMEOUT_SECONDS, expire)
    deadline.daemon = True
    deadline.start()
    try:
        connection.connect()
        sockets.append(connection.sock)
        if timed_out.is_set():
            raise UpstreamError("timeout")
        connection.request("GET", target.path, headers={
            "Accept": "application/json", "Accept-Encoding": "identity",
            "Connection": "close", "User-Agent": "EmpireReadOnlyBridge/1",
        })
        response = connection.getresponse()
        if response.status != 200:
            code = "redirect-refused" if 300 <= response.status < 400 else "http-error"
            raise UpstreamError(code, response.status)
        if response.getheader("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise UpstreamError("invalid-content-type", response.status)
        if response.getheader("Content-Encoding", "identity").lower() != "identity":
            raise UpstreamError("encoded-body-refused", response.status)
        declared = response.getheader("Content-Length")
        if declared is not None:
            try:
                length = int(declared)
            except ValueError:
                raise UpstreamError("invalid-content-length", response.status) from None
            if length < 0 or length > target.max_bytes:
                raise UpstreamError("response-too-large", response.status)
        raw = response.read(target.max_bytes + 1)
        if timed_out.is_set():
            raise UpstreamError("timeout")
        if len(raw) > target.max_bytes:
            raise UpstreamError("response-too-large", response.status)
        result = json.loads(raw, parse_constant=_reject_constant)
        if not isinstance(result, dict):
            raise UpstreamError("invalid-json-object", response.status)
        return result
    except UpstreamError:
        raise
    except (TimeoutError, socket.timeout):
        raise UpstreamError("timeout") from None
    except (ValueError, UnicodeError, RecursionError):
        raise UpstreamError("invalid-json") from None
    except (OSError, http.client.HTTPException):
        raise UpstreamError("timeout" if timed_out.is_set() else "unreachable") from None
    finally:
        deadline.cancel()
        connection.close()


def bounded_text(value, limit=160):
    if not isinstance(value, str):
        return None
    # Control/bidi formatting characters are unnecessary for this status UI.
    value = re.sub(r"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]", "", value).strip()
    return value[:limit] or None


def identifier(value):
    if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", value):
        return value
    return None


def count(value):
    return value if type(value) is int and 0 <= value <= 1_000_000 else None


def timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if parsed.tzinfo is not None else None


def normalize_projects(payload: dict) -> tuple[list, int | None, bool]:
    if type(payload.get("schema_version")) is not int or payload["schema_version"] != 1:
        raise UpstreamError("unsupported-project-schema")
    raw = payload.get("components")
    if not isinstance(raw, list):
        raise UpstreamError("invalid-project-schema")
    projects = []
    seen = set()
    for item in raw[:MAX_PROJECTS]:
        if not isinstance(item, dict):
            raise UpstreamError("invalid-project-schema")
        project_id = identifier(item.get("id"))
        if project_id is None or project_id in seen:
            raise UpstreamError("invalid-project-id")
        seen.add(project_id)
        dependencies = item.get("depends_on")
        dependencies = list(dict.fromkeys(
            dep for dep in dependencies[:MAX_DEPENDENCIES] if identifier(dep)
        )) if isinstance(dependencies, list) else None
        source_exists = item.get("source_exists") if type(item.get("source_exists")) is bool else None
        stage = bounded_text(item.get("stage"), 48)
        project_status = bounded_text(item.get("status"), 64)
        evidence = (f"Registry: {project_status or 'unknown'}; stage: {stage or 'unknown'}. "
                    f"Source files: {'present' if source_exists else 'missing' if source_exists is False else 'unknown'}.")
        projects.append({
            "id": project_id,
            "name": bounded_text(item.get("name")) or project_id,
            "stage": stage,
            "status": project_status,
            "source_exists": source_exists,
            "order": count(item.get("order")),
            "depends_on": dependencies,
            "prerequisites": dependencies or [],
            "evidence": evidence[:180],
            "service_state": None,
        })
    blueprints = payload.get("blueprints")
    return projects, len(blueprints) if isinstance(blueprints, list) else None, len(raw) > MAX_PROJECTS


def normalize_health(payload: dict) -> tuple[dict, int]:
    raw = payload.get("services")
    if not isinstance(raw, list):
        raise UpstreamError("invalid-health-schema")
    services = {}
    allowed_states = {"reachable", "unreachable", "not-probed", "invalid"}
    for item in raw[:MAX_PROJECTS]:
        if not isinstance(item, dict):
            raise UpstreamError("invalid-health-schema")
        key = identifier(item.get("id"))
        if key is None or key in services:
            raise UpstreamError("invalid-health-id")
        value = item.get("state")
        services[key] = value if isinstance(value, str) and value in allowed_states else None
    return services, sum(value == "reachable" for value in services.values())


def status(state="offline", error=None, checked_at=None, http_status=None):
    return {"state": state, "checked_at": checked_at, "error": error, "http_status": http_status}


def empty_state(connected=False):
    return {
        "schema_version": SCHEMA_VERSION,
        "mode": "connected" if connected else "offline",
        "generated_at": stamp(),
        "read_only": True,
        "sources": [
            {"id": "local-registry", "status": "offline", "checked_at": None},
            {"id": "local-runtime", "status": "offline", "checked_at": None},
        ],
        "backends": {
            "local_registry": {**status(), "projects_state": "offline", "health_state": "offline", "source_generated_at": None},
            "local-runtime": status(),
        },
        "projects": [],
        "metrics": {"project_count": None, "blueprint_count": None, "reachable_service_count": None, "revenue": None},
        "warnings": [],
    }


class StateAdapter:
    def __init__(self, connect_local=False, fetcher=None):
        self.connect_local = connect_local
        self.fetcher = fetcher or fetch_json
        self._lock = threading.Lock()
        self._cached = None
        self._last_read = 0.0

    def snapshot(self):
        if not self.connect_local:
            result = empty_state()
            result["warnings"] = ["Local service reads are disabled. Restart with --connect-local to enable them."]
            return result
        with self._lock:
            if self._cached is None or time.monotonic() - self._last_read >= CACHE_SECONDS:
                self._cached = self._collect()
                self._last_read = time.monotonic()
            return copy.deepcopy(self._cached)

    def _collect(self):
        result = empty_state(True)
        warnings = result["warnings"]
        results = {}
        # Exactly three fixed GETs, at most once per five seconds. Parallel
        # reads keep total collection time near the three-second fetch bound.
        with ThreadPoolExecutor(max_workers=3) as pool:
            pending = {key: pool.submit(self.fetcher, key) for key in ENDPOINTS}
        for key in ENDPOINTS:
            checked = stamp()
            try:
                payload = pending[key].result()
                if not isinstance(payload, dict):
                    raise UpstreamError("invalid-json-object")
                if key == "projects":
                    projects, blueprints, truncated = normalize_projects(payload)
                    result["projects"] = projects
                    result["metrics"]["project_count"] = len(payload["components"])
                    result["metrics"]["blueprint_count"] = blueprints
                    result["backends"]["local_registry"]["source_generated_at"] = timestamp(payload.get("generated_at"))
                    if truncated:
                        warnings.append("Project display is limited to the first 64 registry components.")
                elif key == "health":
                    services, reachable = normalize_health(payload)
                    result["metrics"]["reachable_service_count"] = reachable
                    for project in result["projects"]:
                        project["service_state"] = services.get(project["id"])
                    if len(payload["services"]) > MAX_PROJECTS:
                        warnings.append("Service health display is limited to the first 64 services.")
                # The example runtime exposes /api/state, but its field
                # schema is unverified. Only successful JSON reachability is
                # disclosed; raw tasks, messages, keys, and money are dropped.
                results[key] = status("reachable", checked_at=checked, http_status=200)
            except UpstreamError as exc:
                results[key] = status("unavailable", exc.code, checked, exc.http_status)
                warnings.append(f"{key}: {exc.code}")
        registry = result["backends"]["local_registry"]
        projects_status, health_status = results["projects"], results["health"]
        good = sum(s["state"] == "reachable" for s in (projects_status, health_status))
        registry.update(status("reachable" if good == 2 else "partial" if good == 1 else "unavailable",
                             projects_status["error"] or health_status["error"], stamp(),
                             projects_status["http_status"]))
        registry["projects_state"] = projects_status["state"]
        registry["health_state"] = health_status["state"]
        result["backends"]["local-runtime"] = results["local-runtime"]
        invalid_codes = {"invalid-content-type", "encoded-body-refused", "invalid-content-length",
                         "response-too-large", "invalid-json-object", "invalid-json",
                         "unsupported-project-schema", "invalid-project-schema", "invalid-project-id",
                         "invalid-health-schema", "invalid-health-id", "redirect-refused"}
        # A compact "ok" requires both registry and health validity, so clients
        # rendering only sources cannot accidentally hide partial failures.
        for source, checks in zip(result["sources"], ((projects_status, health_status), (results["local-runtime"],))):
            source["status"] = ("ok" if all(s["state"] == "reachable" for s in checks) else
                                "invalid" if any(s["error"] in invalid_codes for s in checks) else "unavailable")
            source["checked_at"] = max(s["checked_at"] for s in checks)
        warnings.append("Reachability and source-file presence do not verify deployment, business readiness, or revenue.")
        warnings.append("Local runtime payload fields are not mapped; only JSON endpoint reachability is verified.")
        return result


def local_authority(value, server_port):
    try:
        parsed = urlsplit("//" + value)
        if parsed.username is not None or parsed.password is not None or parsed.path or parsed.query or parsed.fragment:
            return None
        if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            return None
        if parsed.port != server_port:
            return None
        return (parsed.hostname, parsed.port)
    except (ValueError, TypeError):
        return None


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, port=8787, connect_local=False, root=ROOT, adapter=None):
        self.root = Path(root).resolve()
        self.adapter = adapter or StateAdapter(connect_local=connect_local)
        super().__init__(("127.0.0.1", port), BridgeHandler)


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "EmpireReadOnlyBridge/1"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass  # Do not persist project data, URLs, query strings, or browser headers.

    def reply(self, body, content_type="application/json; charset=utf-8", status_code=200, head=False):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.send_header("Connection", "close")
        self.close_connection = True
        try:
            self.end_headers()
            if not head:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionError, TimeoutError):
            pass

    def local_request(self):
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1:
            return False
        authority = local_authority(hosts[0], self.server.server_port)
        if authority is None:
            return False
        origins = self.headers.get_all("Origin", [])
        if len(origins) > 1:
            return False
        if origins:
            try:
                origin = urlsplit(origins[0])
                if origin.scheme != "http" or origin.path or origin.query or origin.fragment:
                    return False
                if local_authority(origin.netloc, self.server.server_port) != authority:
                    return False
            except ValueError:
                return False
        return self.headers.get("Sec-Fetch-Site", "") not in {"cross-site", "same-site"}

    def do_GET(self):
        self._get()

    def do_HEAD(self):
        self._get(head=True)

    def _get(self, head=False):
        if not self.local_request():
            return self.reply({"error": "Loopback same-origin access required"}, status_code=403, head=head)
        try:
            parsed = urlsplit(self.path)
        except ValueError:
            return self.reply({"error": "Invalid path"}, status_code=400, head=head)
        if parsed.scheme or parsed.netloc or parsed.fragment:
            return self.reply({"error": "Invalid path"}, status_code=400, head=head)
        if parsed.path == "/api/empire-state":
            if parsed.query:
                return self.reply({"error": "Query parameters are not supported"}, status_code=400, head=head)
            if head:
                return self.reply({"error": "GET required"}, status_code=405, head=True)
            return self.reply(self.server.adapter.snapshot())
        path = unquote(parsed.path)
        if path in {"/", "/empire.html", "/index.html", "/README.md"}:
            relative = Path("empire.html" if path == "/" else path.lstrip("/"))
        else:
            parts = path.lstrip("/").split("/")
            if (not path.startswith("/") or any(p in {"", ".", ".."} or p.startswith(".") for p in parts)
                    or "\\" in path or "\x00" in path or parts[0] not in {"js", "css", "data", "assets", "game", "docs"}):
                return self.reply({"error": "Not found"}, status_code=404, head=head)
            relative = Path(*parts)
            if parts[0] == "game" and (len(parts) != 2 or relative.suffix.lower() not in {".js", ".css"}):
                return self.reply({"error": "Not found"}, status_code=404, head=head)
            if parts[0] == "docs" and not (
                    (len(parts) == 2 and relative.suffix.lower() == ".md") or
                    (len(parts) == 3 and parts[1] == "screenshots" and relative.suffix.lower() == ".png")):
                return self.reply({"error": "Not found"}, status_code=404, head=head)
            if relative.suffix.lower() not in {".js", ".css", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".woff", ".woff2", ".ttf", ".txt", ".md"}:
                return self.reply({"error": "Not found"}, status_code=404, head=head)
        file = self.server.root / relative
        try:
            candidate = self.server.root
            for part in relative.parts:
                candidate = candidate / part
                if candidate.is_symlink():
                    raise OSError("Symlink denied")
            file.resolve().relative_to(self.server.root)
            if not file.is_file() or file.stat().st_size > MAX_STATIC_BYTES:
                raise OSError("File unavailable")
            body = file.read_bytes()
            if len(body) > MAX_STATIC_BYTES:
                raise OSError("File too large")
        except (OSError, ValueError):
            return self.reply({"error": "Not found"}, status_code=404, head=head)
        mime = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        if mime.startswith("text/") or relative.suffix == ".js":
            mime += "; charset=utf-8"
        self.reply(body, mime, head=head)

    def mutation_denied(self):
        code = 405 if self.local_request() else 403
        self.reply({"error": "Read-only bridge; mutation routes are not available"}, status_code=code)

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_TRACE = do_CONNECT = mutation_denied


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connect-local", action="store_true", help="Allow the three fixed local GET endpoints")
    parser.add_argument("--port", type=int, default=8787, help="Loopback game server port (default: 8787)")
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("--port must be between 1024 and 65535")
    if args.port in {8770, 8000}:
        parser.error("--port conflicts with an upstream service")
    server = BridgeServer(args.port, args.connect_local)
    mode = "read-only local connections enabled" if args.connect_local else "offline; no upstream probes"
    print(f"Empire of Gods: http://127.0.0.1:{args.port}/ ({mode})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
