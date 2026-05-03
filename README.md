# Minicut

Video editor harness built from the Linkkraft plan slice.

## Commands

### Local development

- `npm run dev:full` starts the local backend and frontend together, with the frontend pointed at `http://127.0.0.1:8787`.
- `npm --prefix backend run dev` starts only the Cloudflare Worker signaling backend on `http://127.0.0.1:8787`.
- `npm start` starts only the frontend on `http://127.0.0.1:4174`.

### Deploy

- `npm run deploy:frontend` builds the frontend with `VITE_MINICUT_SIGNAL_URL` set to the production backend URL and deploys it to Cloudflare Pages.
- `npm --prefix backend run deploy` deploys the signaling backend Worker.

If you need a different backend URL or TURN credentials at build time, set `MINICUT_SIGNAL_URL`, `MINICUT_TURN_URLS`, `MINICUT_TURN_USERNAME`, and `MINICUT_TURN_CREDENTIAL` before running the deploy script.

### Tests

- `npm run test:video-editor` runs the editor unit tests.
- `npm run test:integration` runs the Playwright integration tests and starts both local services automatically.
- `npm --prefix backend run test` runs backend Durable Object tests.

## Architecture and Review Docs

- [Architecture review (EN)](docs/architecture-review-en-2026-05-03.md): independent architecture assessment, idea-to-implementation mapping, Idea 2 and Idea 4 fit analysis, risks, and recommendations.
- [Business logic data flow (EN)](docs/business-logic-data-flow-en-2026-05-03.md): command/patch/reactivity/indexes flow across project/timeline domain, with Mermaid diagrams and source-file links.
- [Test coverage review (EN)](docs/test-coverage-review-en-2026-05-03.md): coverage analysis for model editing, export/rendering, WebRTC/P2P integration, and ffmpeg/ffprobe artifact validation.

### What These Docs Contain

- Architecture intent and current implementation mapping.
- End-to-end business-logic flow through command, authority, patch, store, and derived layers.
- Test coverage depth for domain invariants, browser export artifacts, and multi-peer WebRTC behavior.
- File-level references for fast navigation from docs to implementation/tests.

## Cloudflare

The deploy command expects Cloudflare auth to already be available through `wrangler`.
If login is missing, run `npx --yes wrangler@4 login` first.
