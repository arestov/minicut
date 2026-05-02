# Minicut

Video editor harness built from the Linkkraft plan slice.

## Commands

 
 ## Backend Commands
- `npm --prefix backend install` installs dependencies for the local signaling backend module.
- `npm --prefix backend run dev` starts the Cloudflare Worker signaling backend on `http://127.0.0.1:8787`.
- `npm --prefix backend run test` runs backend Durable Object tests.

## Cloudflare

The deploy command expects Cloudflare auth to already be available through `wrangler`.
If login is missing, run `npx --yes wrangler@4 login` first.
