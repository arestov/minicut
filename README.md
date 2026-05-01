# Minicut

Video editor harness built from the Linkkraft plan slice.

## Commands

- `npm run start` starts the local Vite dev server on `http://127.0.0.1:4174`.
- `npm run video-editor:dev` starts the video editor dev server.
- `npm run video-editor:build` builds the production bundle into `dist-video-editor/`.
- `npm run test:video-editor` runs the unit and jsdom video editor suite.
- `npm run test:integration` runs the Playwright browser suite.
- `npm run deploy` builds the app and deploys `dist-video-editor/` to the Cloudflare Pages project `minicut-video-editor`.

## Cloudflare

The deploy command expects Cloudflare auth to already be available through `wrangler`.
If login is missing, run `npx --yes wrangler@4 login` first.
