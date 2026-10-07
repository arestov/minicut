# Bun-compiled headless desktop host

Date: 2026-10-07. Bun 1.4.2, Windows 11 x64.

Build: `npm run build:desktop-host` (or `bun scripts/build-desktop-host.ts [--outdir <dir>]`);
output `tmp/desktop-host/minicut-host.exe` (about 88 MB: Bun runtime plus bundle).
Entry: `src/video-editor/adapters/node/desktopHostProbe.ts` (probe, not the product host).

```
minicut-host where
minicut-host workspace --profile <dir> [--create-project <title>]
minicut-host media <probe|capabilities|export|proxy ...>      # same surface as media/node/cli.ts
```

## How things are located

- `dkt` / `dkt-all`: `bun build --compile` has no plugin flag, so the build script
  uses `Bun.build({ compile, plugins })` with the same alias resolver as the tests
  (`scripts/dktAliases.mjs`, source `tmp/dkt/js`). DKT is bundled into the binary.
- classic-level addon: embedded. Bun detects the `node-gyp-build` call inside
  `classic-level`, embeds `prebuilds/win32-x64/classic-level.node` into the
  executable and extracts it at run time. Verified by copying only
  `minicut-host.exe` into an empty temp directory (outside the repo) and
  running it with a fresh profile and again to restore it: no sidecar needed.
  The build is per platform/arch; build on the target OS.
- ffmpeg / ffprobe: NOT embedded. `resolveMediaBinaries`: `MINICUT_FFMPEG_PATH` /
  `MINICUT_FFPROBE_PATH`, else `ffmpeg` / `ffprobe` from PATH. The product must
  ship them next to the app and set these variables (or pass explicit paths).
- Profile data: the `--profile` directory (identity file plus
  `workspaces/<room>/leveldb`), created on first run.

## Verified (from an empty temp dir, only the .exe present)

- `where`: prints runtime `bun 1.4.2`, exec path, resolved ffmpeg names.
- `workspace --profile p --create-project X`: creates identity, opens LevelDB,
  default `Project 1` plus `X`; second run without `--create-project` restores
  both projects (`created: false`, same peerId, same durable log counts).
- `media capabilities` (ffmpeg 7.1.1 reported) and `media probe t.mp4` work.

## Notes

- The effect interfaces in the probe entry are explicit call-counting stubs; they
  are not product behaviour. The product host must provide real implementations
  (and fail startup if one is missing).
- `media/node/cli.ts` main-detection now uses `import.meta.main`: inside a
  compiled bundle every module shares the entry URL, so the old argv check ran the
  CLI as soon as the module was imported.
- Not verified: `media export` through the compiled binary (covered under Bun by
  `npm run test:bun:media`, which runs the same service code from source),
  macOS/Linux builds, code signing, antivirus behaviour on the unsigned 88 MB exe,
  startup time of the first run (addon extraction).

## GPUIX packages in a compiled executable (no window)

`node scripts/run-bun.mjs scripts/verify-gpuix-compiled-load.ts` (or
`npm run verify:gpuix-compiled`) compiles two probes and runs them from an empty
temp dir; both load, no window is opened:

- `require("@gpuix/native")` (CJS entry, `index.cjs`): Bun embeds the
  `gpuix-native.win32-x64-msvc.node` binding (exe about 109 MB), no sidecar.
- `import * as solid from "@gpuix/solid"` (ESM, 122 bundled modules): works, but
  `@gpuix/native`'s ESM entry loads its binding through `createRequire`, which
  Bun does not bundle. The binding must sit beside the executable (or
  `NAPI_RS_NATIVE_LIBRARY_PATH` must point to it). Without it the exe throws
  "Cannot find native binding".
- Not verified: creating a renderer/window from a compiled exe, `.tsx` UI
  compiled with the Solid preload (`@gpuix/solid/preload`) under `Bun.build`,
  other platforms. Decision for the app packaging stage: embed via the CJS
  entry (needs the UI to avoid `@gpuix/native` ESM imports) or ship the
  `.node` sidecar.
