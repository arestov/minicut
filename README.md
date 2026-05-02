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

## Cloudflare

The deploy command expects Cloudflare auth to already be available through `wrangler`.
If login is missing, run `npx --yes wrangler@4 login` first.
