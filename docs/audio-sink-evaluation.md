# Audio sink evaluation (Node / Bun, Windows)

Date: 2026-10-07. Windows 11, Node 24.17.0, Bun 1.4.2, default output device
"Realtek(R) Audio" speakers. Candidates were installed only in the scratch dir
`D:\code\tools\audio-probe` (not in the repo); each was run for a 0.5 s, 440 Hz,
-26 dB tone, on Node and (where it loads) Bun. Selecting the sink is a user
decision; nothing is wired into the repo.

The sink must give: PCM output from a decoded/mixed stream, a usable audio clock
(for A/V sync with the GPUIX preview), low and known latency, N-API prebuilds that
load under Bun, and a licence that is fine for a desktop product.

## Comparison

| Candidate | Backend (Windows) | Version / last publish | Licence | Loads in Node | Loads and plays in Bun | Latency / clock API | Prebuilt binary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `node-web-audio-api` | Rust `cpal` -> WASAPI | 2.2.0 / 2026-08 (IRCAM, active) | BSD-3-Clause | yes, played | yes, played | `AudioContext.currentTime` (audio clock), `outputLatency` = 12.8 ms measured, `baseLatency` 0; `getOutputTimestamp()` throws "not yet implemented" | yes (win32 x64/arm64, mac, linux) |
| `@echogarden/audio-io` | MME waveOut (own addon) | 0.4.2 / 2025-05 | MIT | yes, played | yes, played | `positionCallback` with `sampleOffset` / `timePosition` (sample-accurate played position); latency about `bufferDuration` (50 ms set; first callback at 113-117 ms) | yes (win x64/arm64, mac, linux) |
| `audify` | RtAudio -> WASAPI (also DirectSound/ASIO) | 1.10.1 / 2025-08 | MIT (RtAudio: MIT-like) | yes, played | yes, played | `write(pcm)` queue, `getStreamLatency()` returned 0 on WASAPI (not usable), frame-finished callback only; no stream clock | yes (prebuild-install; dep tree of 113 packages incl. cmake-js) |
| `naudiodon2` | PortAudio (MME, DirectSound, WASAPI, WDM-KS) | 2.5.0 / 2025-05 | Apache-2.0 | yes, played | NO: dependency `segfault-handler` is built for Node ABI 137, Bun needs 147 | none (Node streams only; device info exposes default latencies) | bundled, but `gyp` build and ABI-pinned dep |
| `miniaudio_node` | Rust rodio/cpal | 1.6.3 / 2026-08 (single author) | MIT | yes, played | yes, played | none beyond `getState()` / `isPlaying()`; file/buffer oriented, no PCM pull/push stream | yes |
| `speaker` | mpg123 out123 | 0.5.5 / 2024-05 | MIT AND LGPL-2.1-only | yes, played | yes, played | none; Node Writable stream | yes, but unmaintained; LGPL |
| `ffplay` child | SDL2 (WASAPI/DirectSound) | external binary, 7.1.1 on PATH | LGPL/GPL build dependent | played, 857 ms for a 500 ms tone (process start included) | same (plain spawn) | none (stdin PCM only, no clock); about 350 ms startup | not part of the repo; must be shipped |

Measured numbers (single runs, indicative): open-to-first-write 41-44 ms (audify),
170-270 ms (node-web-audio-api, context startup), 93-102 ms (miniaudio_node),
183 ms (naudiodon2). Node and Bun results were identical in kind for every
candidate that loads.

## Findings

- A/V sync needs a played-position clock. Two candidates provide one:
  `@echogarden/audio-io` (sample-accurate played position per callback) and
  `node-web-audio-api` (`currentTime` plus `outputLatency`; `getOutputTimestamp`
  missing, so the render-to-speaker delay comes only from `outputLatency`).
  `audify` could derive a clock by counting finished frames but its latency getter
  reports 0 on WASAPI, so absolute alignment would need a manual offset.
- `node-web-audio-api` is the only candidate on WASAPI with a full mixing graph
  (gain, per-clip scheduling `src.start(when)`, resampling, pan), which matches a
  multi-track editor mix and sample-accurate scheduling. Streaming arbitrary
  decoded PCM into it needs `AudioWorklet` or chunked `AudioBufferSourceNode`
  scheduling; that path was NOT tested here.
- `@echogarden/audio-io` is the simplest pull-style sink: you fill an Int16
  interleaved buffer in a callback and get a position clock. Limits: MME only
  (higher latency, 50-100+ ms buffer), int16 only, a single stream (mixing is
  ours), a small project.
- `naudiodon2` is excluded by Bun incompatibility (ABI-pinned `segfault-handler`);
  it would need removing that dependency, which means a fork.
- `speaker` has no clock, is unmaintained since 2024 and carries LGPL; excluded.
- `miniaudio_node` is file/buffer oriented with no stream clock; excluded for
  sync, usable only for UI sounds.
- `ffplay` as a child process has no clock and high startup latency; only a
  fallback for "play this finished mix" (audition), not for A/V sync.
- Compiled Bun host (stage 3b commit 4): all N-API candidates ship a `.node`
  addon that cannot be embedded into a `bun build --compile` binary reliably, so
  it must sit beside the executable as a sidecar (see the compile doc when added).

## Recommendation (for the user to confirm)

1. Primary: `node-web-audio-api`. WASAPI with 12.8 ms reported output latency,
   audio clock via `currentTime`, scheduling and mixing for free, active
   maintenance (2026-08), BSD-3, works under Node and Bun. Spike needed before
   committing: continuous PCM streaming (AudioWorklet ring buffer) and drift
   against `currentTime` over minutes.
2. Fallback / simplest pull sink: `@echogarden/audio-io` (MIT) if streaming through
   Web Audio proves awkward; accept MME latency and mix in our own code.
3. Do not pick `naudiodon2`, `speaker`, `miniaudio_node`, or `ffplay` for the
   preview path.

Either choice would be isolated behind a host-side audio effect executor; the DKT
graph only sees serialisable playback state, never handles.

## Not verified

- Sound quality, glitches or underruns by ear (no listening done; tones were played
  at low gain, 0.5 s per run).
- Behaviour after a long run, device hot-swap, exclusive-mode WASAPI, sample rates
  other than 48 kHz, and measured end-to-end latency with a loopback.
- Bun compiled binary loading of the addons.
- `node-web-audio-api` AudioWorklet streaming path.
