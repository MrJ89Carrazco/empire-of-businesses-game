# Empire of Gods: Business Command

A fictional browser game about planning and delivery. Play eighteen missions across nine generic business categories, or visit the animated Olympus Station. No accounts, API keys, paid services, or real-world actions are needed.

- Open `empire.html` for the business campaign.
- Open `index.html` for the original station demo.
- Read the [player guide](docs/PLAY.md).

The nine categories are Web Studio, Home Services, Publishing Studio, Review Desk, Apparel Studio, Research Services, Property Research, Community Programs, and Fitness Studio. Names, dependencies, rewards, credits, and outcomes are game mechanics, not a business plan or claims about live organizations.

## Hosted game

GitHub Pages serves only the static practice game. Browser-local saves, validated save import/export, all eighteen missions, the station, and local planning-brief downloads work there. The hosted Operations tab offers practice planning only: local-state refresh is disabled and the built dashboard blocks network connections with `connect-src 'none'`.

Progress does not sync between devices or website addresses. Export a save before clearing browser data or moving to another address.

## Local development

Development checks require Node 18+ and Python 3.10+. There are no third-party runtime dependencies and no `npm install` step.

    npm run verify
    npm run preview:pages

Open http://127.0.0.1:8788/empire.html. Verification runs JavaScript syntax checks, 26 Node tests, 36 Python tests, and a clean static build. Test guards reject missing suites, dropped counts, skipped tests, and failed runs.

    npm test              # all 62 automated cases
    npm run check         # JavaScript syntax checks
    npm run build         # frontend-only dist/ output

Upload only `dist/` to a static host. Relative asset paths support repository-prefixed URLs. The generated build is ignored by Git.

## Optional local bridge

The generic [read-only bridge](bridge/README.md) is a developer example. It defaults offline, needs no credentials, and is never included in the hosted build. It does not configure or start upstream services. Run `python3 -m bridge.server --port 8787`, or use `Start Empire.cmd` on Windows, then open http://127.0.0.1:8787/empire.html.

The separately enabled example connection mode needs services you implement against the documented contracts. No live integration, business activity, or revenue is verified by this project.

## Verification and deployment

See [verification scope](docs/VERIFICATION.md). Automated model, controller, adapter, HTTP, and publication checks do not establish a visual/browser pass. The optional browser suite is documented there.

The verification workflow runs on pushes and pull requests. The separate manual Pages workflow verifies the source, uploads only `dist/`, and deploys it. Select **GitHub Actions** as the repository's Pages source before deploying. Workflow dependencies use immutable commit pins.

## Attribution

The original public station demo is based on [MrJCarrazco/eog](https://github.com/MrJCarrazco/eog) at commit `6943afba61f9a2c511f04b44581f7872847b1c79`. The MIT copyright notice for Andrew Sims remains in [LICENSE](LICENSE) and the source. The bundled VT323 font retains its [SIL Open Font License](assets/fonts/OFL-VT323.txt). The business practice campaign is an adaptation alongside that demo.
