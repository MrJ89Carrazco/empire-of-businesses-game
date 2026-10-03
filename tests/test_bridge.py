"""Standard-library bridge tests. All network tests use loopback fake upstreams."""
import copy
from contextlib import contextmanager
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from bridge import server as bridge


REGISTRY = {
    "schema_version": 1,
    "generated_at": "2025-01-01T00:00:00Z",
    "vault": "PRIVATE-VAULT-PATH",
    "components": [{
        "id": "client-services", "name": "Client Websites / Web Agency",
        "stage": "delivery", "status": "source-present", "source_exists": True,
        "order": 8, "depends_on": ["local-runtime", "status-viewer"],
        "path": "PRIVATE-FILE-PATH", "health_url": "https://example.invalid/do-not-follow",
        "note_url": "obsidian://PRIVATE-NOTE", "api_key": "PRIVATE-KEY",
        "revenue": 999999,
    }],
    "blueprints": [{"id": "a", "title": "PRIVATE-BLUEPRINT-TITLE"}],
}
HEALTH = {"checked_at": "2025-01-01T00:00:00Z", "services": [
    {"id": "client-services", "state": "not-probed", "reason": "PRIVATE-DIAGNOSTIC"},
    {"id": "local-runtime", "state": "reachable", "http_status": 200},
]}
RUNTIME = {"tasks": [{"secret": "PRIVATE-TASK"}], "api_key": "PRIVATE-KEY", "revenue": 999999}


def fixture_fetch(key):
    return copy.deepcopy({"projects": REGISTRY, "health": HEALTH, "local-runtime": RUNTIME}[key])


@contextmanager
def running(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


class FakeUpstream(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.server.calls.append((self.command, self.path, dict(self.headers)))
        spec = self.server.responses[self.path]
        if spec.get("delay"):
            time.sleep(spec["delay"])
        body = spec.get("body", b"{}")
        self.send_response(spec.get("status", 200))
        self.send_header("Content-Type", spec.get("content_type", "application/json"))
        if not spec.get("no_length"):
            self.send_header("Content-Length", str(spec.get("declared_length", len(body))))
        for key, value in spec.get("headers", {}).items():
            self.send_header(key, value)
        try:
            self.end_headers()
            if spec.get("trickle"):
                for byte in body:
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(spec["trickle"])
            else:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionError):
            pass


@contextmanager
def fake_upstreams(spec=None):
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
    server.daemon_threads = True
    server.calls = []
    server.responses = {
        "/api/projects": {"body": json.dumps(REGISTRY).encode()},
        "/api/health": {"body": json.dumps(HEALTH).encode()},
        "/api/state": {"body": json.dumps(RUNTIME).encode()},
    }
    if spec:
        server.responses["/api/projects"].update(spec)
    endpoints = {key: bridge.Endpoint(server.server_port, value.path, value.max_bytes)
                 for key, value in bridge.ENDPOINTS.items()}
    with running(server), patch.object(bridge, "ENDPOINTS", endpoints):
        yield server


class AdapterTests(unittest.TestCase):
    def test_default_is_offline_and_does_not_fetch(self):
        def unexpected(_key):
            self.fail("Offline adapter made a network request")
        state = bridge.StateAdapter(fetcher=unexpected).snapshot()
        self.assertEqual(state["mode"], "offline")
        self.assertTrue(state["read_only"])
        self.assertEqual(state["schema_version"], 1)
        self.assertEqual(state["projects"], [])
        self.assertTrue(all(value is None for value in state["metrics"].values()))
        self.assertEqual([s["status"] for s in state["sources"]], ["offline", "offline"])

    def test_normalized_contract_and_no_private_fields(self):
        state = bridge.StateAdapter(True, fixture_fetch).snapshot()
        self.assertEqual(state["mode"], "connected")
        self.assertEqual([s["status"] for s in state["sources"]], ["ok", "ok"])
        project = state["projects"][0]
        self.assertEqual(project["id"], "client-services")
        self.assertEqual(project["prerequisites"], ["local-runtime", "status-viewer"])
        self.assertEqual(project["service_state"], "not-probed")
        self.assertIn("Registry: source-present", project["evidence"])
        self.assertEqual(state["metrics"], {"project_count": 1, "blueprint_count": 1,
                                          "reachable_service_count": 1, "revenue": None})
        text = json.dumps(state)
        self.assertNotIn("PRIVATE", text)
        self.assertNotIn("999999", text)
        self.assertNotIn("health_url", text)

    def test_cache_coalesces_and_returns_copy(self):
        calls = []
        def fetch(key):
            calls.append(key)
            return fixture_fetch(key)
        adapter = bridge.StateAdapter(True, fetch)
        first = adapter.snapshot()
        first["projects"].clear()
        second = adapter.snapshot()
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(second["projects"]), 1)
        with patch.object(bridge, "CACHE_SECONDS", 0):
            adapter.snapshot()
        self.assertEqual(len(calls), 6)

    def test_unavailable_is_not_fabricated_success(self):
        def fail(_key):
            raise bridge.UpstreamError("unreachable")
        state = bridge.StateAdapter(True, fail).snapshot()
        self.assertEqual(state["projects"], [])
        self.assertIsNone(state["metrics"]["project_count"])
        self.assertTrue(all(s["status"] == "unavailable" for s in state["sources"]))
        self.assertEqual(state["backends"]["local_registry"]["state"], "unavailable")

    def test_partial_health_failure_preserves_registry(self):
        def fetch(key):
            if key == "health":
                raise bridge.UpstreamError("timeout")
            return fixture_fetch(key)
        state = bridge.StateAdapter(True, fetch).snapshot()
        self.assertEqual(state["sources"][0]["status"], "unavailable")
        self.assertEqual(state["backends"]["local_registry"]["state"], "partial")
        self.assertIsNone(state["metrics"]["reachable_service_count"])
        self.assertIsNone(state["projects"][0]["service_state"])

    def test_wrong_schema_is_invalid(self):
        def fetch(key):
            data = fixture_fetch(key)
            if key == "projects":
                data["schema_version"] = 2
            return data
        state = bridge.StateAdapter(True, fetch).snapshot()
        self.assertEqual(state["projects"], [])
        self.assertEqual(state["sources"][0]["status"], "invalid")
        self.assertEqual(state["backends"]["local_registry"]["error"], "unsupported-project-schema")

    def test_project_strings_and_arrays_are_bounded(self):
        data = copy.deepcopy(REGISTRY)
        row = data["components"][0]
        row.update(name="x" * 1000, stage="s" * 1000, status="z" * 1000,
                   depends_on=["x" + str(i) for i in range(50)])
        data["components"] = [{**row, "id": "p" + str(i)} for i in range(100)]
        projects, count, truncated = bridge.normalize_projects(data)
        self.assertEqual(len(projects), 64)
        self.assertTrue(truncated)
        self.assertEqual(len(projects[0]["name"]), 160)
        self.assertLessEqual(len(projects[0]["evidence"]), 180)
        self.assertEqual(len(projects[0]["prerequisites"]), 16)

    def test_missing_fields_are_unknown(self):
        projects, blueprints, _ = bridge.normalize_projects({"schema_version": 1, "components": [{"id": "only-id"}]})
        row = projects[0]
        self.assertEqual(row["name"], "only-id")
        self.assertIsNone(row["source_exists"])
        self.assertIsNone(row["depends_on"])
        self.assertEqual(row["prerequisites"], [])
        self.assertIsNone(row["order"])
        self.assertIsNone(blueprints)
        self.assertIn("unknown", row["evidence"])

    def test_malformed_rows_and_duplicate_ids_fail_closed(self):
        for items in [[None], [{"id": "bad id"}], [{"id": "x"}, {"id": "x"}]]:
            with self.subTest(items=items), self.assertRaises(bridge.UpstreamError):
                bridge.normalize_projects({"schema_version": 1, "components": items})

    def test_wrong_types_are_not_coerced(self):
        data = copy.deepcopy(REGISTRY)
        data["components"][0].update(source_exists="yes", order=True, stage={"key": "secret"}, depends_on="x")
        project = bridge.normalize_projects(data)[0][0]
        for key in ["source_exists", "order", "stage", "depends_on"]:
            self.assertIsNone(project[key])
        with self.assertRaises(bridge.UpstreamError):
            bridge.normalize_projects({"schema_version": True, "components": []})

    def test_health_unknown_states_are_not_claimed_reachable(self):
        services, reachable = bridge.normalize_health({"services": [{"id": "x", "state": "healthy"}]})
        self.assertEqual(services, {"x": None})
        self.assertEqual(reachable, 0)

    def test_control_characters_are_removed(self):
        self.assertEqual(bridge.bounded_text("ok\x00\n\u202e good"), "ok good")


class TransportTests(unittest.TestCase):
    def test_real_fake_upstreams_use_get_and_fixed_paths(self):
        with fake_upstreams() as upstream:
            state = bridge.StateAdapter(True).snapshot()
            self.assertEqual(state["sources"][0]["status"], "ok")
            self.assertEqual({call[1] for call in upstream.calls}, {"/api/projects", "/api/health", "/api/state"})
            for method, _path, headers in upstream.calls:
                self.assertEqual(method, "GET")
                self.assertNotIn("Authorization", headers)
                self.assertNotIn("Cookie", headers)

    def test_arbitrary_target_is_refused_before_network(self):
        with self.assertRaises(bridge.UpstreamError) as caught:
            bridge.fetch_json("http://127.0.0.1:1/private")
        self.assertEqual(caught.exception.code, "endpoint-not-allowed")

    def test_redirect_is_not_followed(self):
        with fake_upstreams({"status": 302, "headers": {"Location": "/forbidden"}}) as upstream:
            with self.assertRaises(bridge.UpstreamError) as caught:
                bridge.fetch_json("projects")
            self.assertEqual(caught.exception.code, "redirect-refused")
            self.assertEqual(len(upstream.calls), 1)

    def test_http_error_is_not_returned_as_success(self):
        with fake_upstreams({"status": 503, "body": b"PRIVATE FAILURE"}):
            with self.assertRaises(bridge.UpstreamError) as caught:
                bridge.fetch_json("projects")
            self.assertEqual(caught.exception.code, "http-error")
            self.assertEqual(caught.exception.http_status, 503)
            self.assertNotIn("PRIVATE", str(caught.exception))

    def test_invalid_json_and_non_objects(self):
        for body in [b"not-json", b"[]", b'{"value": NaN}', b"\xff"]:
            with self.subTest(body=body), fake_upstreams({"body": body}):
                with self.assertRaises(bridge.UpstreamError):
                    bridge.fetch_json("projects")

    def test_response_length_bound_with_and_without_header(self):
        for no_length in [False, True]:
            with self.subTest(no_length=no_length), fake_upstreams({"body": b"x" * (512 * 1024 + 1), "no_length": no_length}):
                with self.assertRaises(bridge.UpstreamError) as caught:
                    bridge.fetch_json("projects")
                self.assertEqual(caught.exception.code, "response-too-large")

    def test_content_type_and_encoding_are_restricted(self):
        for spec in [{"content_type": "text/html"}, {"headers": {"Content-Encoding": "gzip"}}]:
            with self.subTest(spec=spec), fake_upstreams(spec):
                with self.assertRaises(bridge.UpstreamError):
                    bridge.fetch_json("projects")

    def test_timeout_is_bounded(self):
        with fake_upstreams({"delay": 0.3}), patch.object(bridge, "TIMEOUT_SECONDS", 0.06):
            start = time.monotonic()
            with self.assertRaises(bridge.UpstreamError) as caught:
                bridge.fetch_json("projects")
            self.assertLess(time.monotonic() - start, 0.3)
            self.assertEqual(caught.exception.code, "timeout")

    def test_trickle_body_has_absolute_deadline(self):
        with fake_upstreams({"body": b'{"slow": "aaaaaaaaaaaaaaaa"}', "trickle": 0.03}), patch.object(bridge, "TIMEOUT_SECONDS", 0.12):
            start = time.monotonic()
            with self.assertRaises(bridge.UpstreamError) as caught:
                bridge.fetch_json("projects")
            self.assertLess(time.monotonic() - start, 0.35)
            self.assertEqual(caught.exception.code, "timeout")

    def test_environment_proxy_does_not_change_target(self):
        with fake_upstreams(), patch.dict("os.environ", {"http_proxy": "http://127.0.0.1:1", "HTTP_PROXY": "http://127.0.0.1:1"}):
            self.assertEqual(bridge.fetch_json("projects")["schema_version"], 1)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / "index.html").write_text("original", encoding="utf-8")
        (root / "empire.html").write_text("game", encoding="utf-8")
        (root / "README.md").write_text("# Read me", encoding="utf-8")
        (root / "js").mkdir()
        (root / "js" / "app.js").write_text("hello", encoding="utf-8")
        (root / "game").mkdir()
        (root / "game" / "empire.js").write_text("game-script", encoding="utf-8")
        (root / "game" / "empire.css").write_text("game-style", encoding="utf-8")
        (root / "docs" / "screenshots").mkdir(parents=True)
        (root / "docs" / "guide.md").write_text("# Guide", encoding="utf-8")
        (root / "docs" / "screenshots" / "view.png").write_bytes(b"PNG")
        (root / ".env").write_text("SECRET", encoding="utf-8")
        self.server = bridge.BridgeServer(0, root=root)
        self.context = running(self.server)
        self.context.__enter__()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.temp.cleanup()

    def request(self, path="/api/empire-state", method="GET", headers=None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        client.request(method, path, headers=headers or {})
        response = client.getresponse()
        result = response.status, dict(response.headers), response.read()
        client.close()
        return result

    def test_offline_api(self):
        code, headers, body = self.request()
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["mode"], "offline")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_static_get_and_head(self):
        self.assertEqual(self.request("/")[2], b"game")
        self.assertEqual(self.request("/empire.html")[2], b"game")
        self.assertEqual(self.request("/index.html")[2], b"original")
        self.assertEqual(self.request("/js/app.js")[2], b"hello")
        code, headers, body = self.request("/", method="HEAD")
        self.assertEqual(code, 200)
        self.assertEqual(body, b"")
        self.assertEqual(headers["Content-Length"], "4")

    def test_connected_game_and_documentation_allowlist(self):
        for path in ["/game/empire.js", "/game/empire.css", "/docs/guide.md", "/docs/screenshots/view.png", "/README.md"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 200)

    def test_new_static_roots_do_not_expose_arbitrary_files(self):
        for path in ["/game/private.json", "/game/nested/code.js", "/docs/private.json", "/docs/view.png", "/docs/screenshots/code.js", "/docs/../.env", "/docs/screenshots/../../.env"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_wrong_host_or_port_refused(self):
        for host in ["evil.example", "127.0.0.1:1", "127.0.0.1.evil.example", "user@127.0.0.1", "127.0.0.1", "[::1]:1"]:
            with self.subTest(host=host):
                self.assertEqual(self.request(headers={"Host": host})[0], 403)

    def test_remote_and_different_local_origins_refused(self):
        for origin in ["https://evil.example", "null", "http://localhost:1", f"http://localhost:{self.server.server_port}", "file://"]:
            with self.subTest(origin=origin):
                self.assertEqual(self.request(headers={"Origin": origin})[0], 403)

    def test_same_origin_allowed(self):
        self.assertEqual(self.request(headers={"Origin": f"http://127.0.0.1:{self.server.server_port}"})[0], 200)

    def test_cross_site_metadata_refused(self):
        self.assertEqual(self.request(headers={"Sec-Fetch-Site": "cross-site"})[0], 403)

    def test_mutation_methods_refused(self):
        for method in ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"]:
            with self.subTest(method=method):
                self.assertEqual(self.request(method=method)[0], 405)

    def test_no_arbitrary_proxy_query_or_route(self):
        self.assertEqual(self.request("/api/empire-state?url=http://example.com")[0], 400)
        self.assertEqual(self.request("/api/proxy")[0], 404)
        self.assertEqual(self.request("http://evil.example/api/empire-state", headers={"Host": f"127.0.0.1:{self.server.server_port}"})[0], 400)
        self.assertEqual(self.request(method="HEAD")[0], 405)

    def test_hidden_files_traversal_directory_listing_and_code_refused(self):
        for path in ["/.env", "/.git/config", "/bridge/server.py", "/js/../.env", "/js/%2e%2e/.env", "/js/", "/assets", "/js/app.js%00", "/js/../../index.html"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_static_symlink_refused(self):
        (Path(self.temp.name) / "js" / "secret.js").symlink_to(Path(self.temp.name) / ".env")
        self.assertEqual(self.request("/js/secret.js")[0], 404)

    def test_browser_secrets_not_forwarded(self):
        with fake_upstreams() as upstream:
            self.server.adapter = bridge.StateAdapter(True)
            code, _headers, body = self.request(headers={"Authorization": "Bearer SECRET", "Cookie": "secret=SECRET"})
            self.assertEqual(code, 200)
            self.assertNotIn(b"SECRET", body)
            for _method, _path, headers in upstream.calls:
                self.assertNotIn("Authorization", headers)
                self.assertNotIn("Cookie", headers)


if __name__ == "__main__":
    unittest.main()
