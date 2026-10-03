# Optional generic local bridge

A Python 3.10+ standard-library example server for the game and a bounded, read-only status feed. It defaults offline. It does not execute tasks, modify services, accept credentials, publish, or spend money. It is not an authentication gateway, public API, or multi-user server.

## Start offline

    python3 -m bridge.server --port 8787

Open http://127.0.0.1:8787/empire.html. Starting the server or reading `/api/empire-state` in offline mode contacts no upstream service. Windows users can run `Start Empire.cmd`.

## Optional example connections

    python3 -m bridge.server --connect-local --port 8787

This separately enabled mode requires compatible services that you implement and start on the same computer. No upstream service is bundled or configured. It uses only three fixed GET targets:

- Registry: `http://127.0.0.1:8770/api/projects`, a JSON object with integer `schema_version: 1`, a `components` array, optional `blueprints` array, and optional `generated_at` timestamp.
- Health: `http://127.0.0.1:8770/api/health`, a JSON object with a `services` array of project `id` and `state` records.
- Runtime: `http://127.0.0.1:8000/api/state`, a JSON object used only to check endpoint reachability.

A component includes an identifier and may include a name, stage, status, source-file presence flag, order, and dependency identifiers. These are inventory assertions, not proof of an operating organization. Example campaign component categories are `client-services`, `content-studio`, and `operations-hub`.

The game requests its same-origin `/api/empire-state` endpoint when you choose refresh. There is no background polling. Connected requests read the fixed targets in parallel with a three-second deadline per fetch and a five-second cache. Starting the bridge does not probe services, even with connections enabled. Stop with Ctrl+C. Snapshots are not written to disk.

## Normalized contract

The companion `empire-state.schema.json` describes the frontend core. Files in `examples/` are synthetic fixtures.

- `schema_version` is integer `1`; `read_only` is always `true`.
- `mode` is `offline` or `connected`. Connected means reads were enabled, not that any succeeded.
- `sources` identifies `local-registry` and `local-runtime`, each with status and check time.
- `projects` contains at most 64 sanitized inventory entries, with bounded IDs, names, evidence, and prerequisites. Missing optional values remain null.
- `backends.local_registry` reports independent registry and health states. Partial success remains partial.
- `backends.local-runtime` reports reachability only. No runtime task, transaction, or business fields are mapped.
- Metrics include registry component count, blueprint-entry count, and reachable-service count when available. Revenue is always null.
- Warnings use fixed safe diagnostics. Raw payloads, exceptions, links, paths, credentials, and task contents are not returned.

Offline mode contains no projects, successful checks, or substitute fixture data. Unavailable data is not presented as zero or as a fresh successful snapshot.

## Safety boundaries

- Binds only to `127.0.0.1`. Host must match loopback and the listening port; any browser Origin must match the same local origin. Cross-site fetch metadata is rejected and no CORS permission is granted.
- API GET only. Mutation methods and API HEAD are refused without upstream reads. There are no caller-supplied URLs, proxy routes, or query parameters.
- Fixed targets only. Redirects, environment proxies, compressed bodies, and non-JSON responses are rejected. Browser cookies and authorization headers are never forwarded.
- Input limits are 512 KiB for inventory and 128 KiB for each other source. Output limits are 64 projects, 16 dependencies each, 160-character names, and 180-character evidence. The client caps the streamed response at 1 MiB.
- Static serving uses an explicit path/extension allowlist; hidden files, symlinks, backend source, history, traversal, and arbitrary filesystem access are refused.
- Responses use no-store, nosniff, a same-origin resource policy, and Content Security Policy. Logs do not retain URLs, headers, project data, or exception text.

## Tests

    npm run test:bridge

Tests use fake temporary loopback upstreams and never probe a user's existing services. The complete hosted game works without this backend. Deploy only the generated `dist/` directory to a static host.
