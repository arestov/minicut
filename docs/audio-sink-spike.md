# Audio sink spike: `node-web-audio-api` streaming, clock, seek

Date: 2026-10-07. Windows 11, Node 24.17.0, Bun 1.4.2, `node-web-audio-api` 2.2.0, default output
"Realtek(R) Audio" (WASAPI, 48 kHz). Follows `docs/audio-sink-evaluation.md`. Spike code only:
`scripts/audio-spike/` (all measurements reproducible under Node; stream, drift and gap scripts
also run under Bun) and `src/video-editor/media/node/audio/audioPlaybackClock.ts` (+ test).

Source signal for every run: ffmpeg decode of a two-input fixture mix (`audio-tone.wav` +
`video-audio.mp4` audio, looped, `amix`) to f32le stereo 48 kHz on stdout.

## 1. Load check

`AudioContext` constructs, plays and closes under Node and Bun (`sampleRate` 48000,
`baseLatency` 0, `outputLatency` 12.8 ms, `audioWorklet.addModule` present). Issues found:

- `audioWorklet.addModule(<absolute Windows path>)` fails (`ERR_UNSUPPORTED_ESM_URL_SCHEME`: the
  library passes `D:\...` to `import()`). Workaround used: load the processor source through a
  `blob:` URL. Worklet code then cannot `import` anything.
- `getOutputTimestamp()` throws "not yet implemented".
- `outputLatency` is not constant: over a 5 min run it read 12.79 ms, 2.1 ms and 0 at different
  moments. Treat it as a hint, not a calibrated offset.

## 2. Continuous PCM streaming (60 s runs, 100 ms target buffer, 20 ms chunks)

Underruns come from `AudioContext.playbackStats` (device-callback level), plus per-approach counters.

| Approach | 60 s device underrun events | Notes |
| --- | --- | --- |
| `AudioWorkletNode` queue (chunks over `port`) | 3 events, 16.6 ms total (0 starved `process()` calls) | 20 s with 40 ms main-thread stalls every 100 ms: 4 events / 38 ms. The glitches come from the worklet render path, not from feeding. |
| Scheduled `AudioBufferSourceNode` chunks | 0 events | 1 late chunk (startup), min lead 5 ms; under the same stall load 0 events, min lead 40 ms |
| `ScriptProcessorNode` (1024 frames) | 0 events, 0 starved callbacks | works, but deprecated API and main-thread bound; the 1024-frame period adds 21 ms |

Sample-exactness of scheduling (`gap-check.mjs`, offline render of 200 DC chunks at 20 / 10 / 7.3 ms,
start times rounded to the sample grid): 0 gap samples, 0 overlap samples.

Buffer size vs underruns (15 s each, 10 ms chunks):

| Target buffer | Worklet device events (starved calls) | Scheduled late chunks / min lead |
| --- | --- | --- |
| 20 ms | 6 (2458 starved calls, max step 0.026) | 56 late / 0.3 ms |
| 40 ms | 1 (3) | 0 / 16 ms |
| 100 ms | 1-3 | 0 / 79-89 ms |
| 200 ms | 1 (0) | 0 / 179 ms |

Bun 1.4.2: scheduled 15 s: 0 events, 0 late; worklet 8 s: 1 event (same as Node).

Chosen approach: scheduled `AudioBufferSourceNode` chunks, 20 ms chunks, 100 ms lookahead (floor
about 40 ms). Reasons: zero device underruns, sample-exact joins, the full graph (per-track gain,
pan, fades) stays available, no worklet thread or blob-URL workaround. The cost of lookahead: a
volume or mute change is heard after up to the lookahead unless it is applied on a `GainNode`
downstream of the chunk sources (do that: master and per-track gain nodes after the sources).
Worklet remains the fallback if sample-level DSP is needed later.

## 3. Clock

`clock-drift.mjs`, 300 s, `currentTime` polled every ~16 ms (Windows timer granularity) against
`process.hrtime`:

- Rate: audio clock vs hrtime -63 ppm (slow, about 3.8 ms/min, 19 ms over 5 min), steady and
  linear. A 20 s Bun run measured -9 ppm, so the rate is device/session dependent. Two independent
  clocks diverge, which is why audio must be master.
- `currentTime` is stepped: p50 10.67 ms (512 frames), p99 21.3 ms, max 74.7 ms (one stall).
  Detrended error vs hrtime: std 3.7 ms, max 18.3 ms.
- `createAudioPlaybackClock` (system-clock interpolation, EMA 0.05, monotonic): std 2.1 ms, max
  10.5 ms, same -63 ppm trend (it follows audio, as intended).
- `baseLatency` is 0; `outputLatency` 12.8 ms nominal but fluctuating; `getOutputTimestamp`
  unavailable. Residual audible offset is about +-13 ms, below one frame at 60 fps.

## 4. Clock prototype

`createAudioPlaybackClock(ctx, options)` returns a `PlaybackClock`: `nowMonotonicMs` follows
`currentTime - outputLatency` with system-clock interpolation, smoothed offset, hard resync above
40 ms, monotonic, frozen while the context is not `running`; `nowEpochMs` and frame scheduling are
injected. Unit tests (fake context, no device): monotonic under 10.7 ms steps, follows a 0.1 %-slow
audio clock, latency compensation, freeze/resume, and `PlaybackRuntime` advancing, tracking an audio
stall and completing at the boundary from it.

## 5. Seek / pause / resume

`seek.mjs`, scheduled engine, 10 seeks, ffmpeg respawned per seek:

| Step | ms |
| --- | --- |
| ffmpeg spawn to first PCM byte | avg 199, max 244 |
| seek call to first chunk scheduled | avg 201, max 247 |
| seek call to non-zero sample at an `AnalyserNode` after the gain | avg 220, max 268 (includes the 20 ms start lead; +12.8 ms output latency at the speaker) |

Process spawn plus graph init dominates. To get under 100 ms: keep a warm decoder per timeline
(plain ffmpeg cannot seek a running process; use a long-lived decoder that accepts seek commands) or
decode audio into a PCM cache/proxy and read ranges from it.

Stop click (offline render, 440 Hz sine cut near a peak): hard cut max sample step 0.997; 5 ms
linear gain ramp 0.058; 10 ms ramp 0.058 (the signal's own slope). Use a 5 ms ramp on
pause/seek/stop and stop the scheduled sources after the ramp.

## Risks

- Glitches and clicks were not judged by ear; the numbers are API counters and offline renders.
- Rate mismatch (+-60 ppm, device specific): the audio clock must drive the cursor. Do not resample
  audio to chase video; drop or repeat video frames instead.
- `outputLatency` instability; device hot-swap, `statechange` and sample-rate change not tested.
- Worklet blob-URL workaround and missing `getOutputTimestamp` are library gaps on Windows.
- Native addon inside a `bun build --compile` binary (sidecar `.node`) untested.
- Decoder respawn sets seek-to-sound at about 220 ms.
- Fixture loops with `-ss` on both inputs print ffmpeg "non monotonically increasing dts" warnings
  (stream_loop on mp4); a real mix uses `atrim`/`adelay` per clip, not loops.

## Proposal: stage 4-audio commits

1. `feat(audio): add audio sink service` host-side effect executor owning one `AudioContext`,
   master and track `GainNode`s, chunk scheduler (20 ms chunks, 100 ms lookahead), stop/seek with a
   5 ms ramp. The effect payload carries everything (timeline start, rate, mix descriptor); no graph
   reads.
2. `feat(media): stream timeline audio mix as f32 PCM` media service job: ffmpeg mix graph to a
   PCM stream starting at the payload cursor, backpressure by consumer demand.
3. `feat(audio): drive PlaybackRuntime from the audio clock` promote `createAudioPlaybackClock`
   (latency median, resync policy, suspended state); the host composition passes it to
   `PlaybackRuntime`. DKT model and protocol unchanged.
4. `feat(audio): seek, pause and resume` warm decoder or PCM cache to bring seek under 100 ms.
5. `test(audio): ...` clock and scheduler unit tests, headless render test through
   `OfflineAudioContext`; `docs(audio)` update.

A/V sync policy: audio is master. The cursor is timeline time derived from the audio clock
(`currentTime - outputLatency`); the video presenter follows the cursor: it shows the frame for the
current cursor and drops or repeats frames when it falls behind, never time-stretches audio. Clip
offsets are applied only when mapping the cursor to source time. Pause uses the presented cursor
(existing behaviour) and stays consistent because the same clock produced it. When the audio context
is suspended or absent (headless, no device), fall back to the system `PlaybackClock`.
