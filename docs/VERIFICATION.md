# Verification scope

The source is designed for reproducible offline verification with Node 18+ and Python 3.10+:

    npm run verify

## Automated coverage

- 26 Node cases cover the nine-category, eighteen-mission dependency graph; focus and credit accounting; single-claim rewards; full campaign completion; validated save replay; malformed input; storage failure and recovery; Operations separation; bounded feed validation; asset paths; static publication boundaries; and missing/empty test guards.
- 36 Python cases cover offline defaults, generic synthetic source contracts, bounded sanitization, missing values, partial failures, caching, fixed GET-only targets, method restrictions, redirects, byte/time limits, proxy and header isolation, loopback Host/Origin enforcement, safe static paths, traversal, symlinks, and the Unicode response budget.
- JavaScript syntax checks and the static build run as part of verification.
- Test guards require at least the complete 26 + 36 baseline, no skipped tests, and successful execution.

The tests use synthetic fixtures and temporary loopback servers. They do not contact a user's real services. Fixture values are not live observations. A passing suite does not prove real business operations, revenue, or external workflow execution.

## Browser and platform checks

Automated controller tests use a minimal DOM harness and do not establish browser rendering, layout, accessibility, or Windows execution. No visual/browser pass is claimed for this distribution.

An optional browser suite is provided in `tests/browser_smoke.py`. It requires an environment with the Python Playwright package and a working Chromium executable. Run:

    python3 tests/browser_smoke.py

The suite starts a temporary local server. To test an already-running offline bridge, use:

    python3 tests/browser_smoke.py --base-url http://127.0.0.1:8787

Set `CHROMIUM_PATH` if Chromium is installed somewhere other than the suite's default. The suite uses isolated browser profiles and synthetic intercepted feeds. Do not provide production credentials or customer data. Review any generated screenshots before claiming visual readiness.

## Publication boundary

`npm run build` creates `dist/` from explicit frontend directories and files. It excludes the Python backend, examples, tests, scripts, workflows, and source documentation. The dashboard is marked static and uses `connect-src 'none'`. All relative HTML/CSS references and thirteen character sprite paths are checked for repository-prefixed hosting.

Actual hosting and deployment must be checked separately against the deployed commit.
