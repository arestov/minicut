# Desktop audio playback (stage 4-audio)

GPUIX desktop app plays the timeline audio through `node-web-audio-api` (WASAPI on Windows) and
the audio device clock drives the playback cursor. This document describes what shipped, then
keeps the spike measurements it was built on (sections 1-5 and Risks). Follows
`docs/audio-sink-evaluation.md`.

## What shipped

Data path: model run (`$fx_applyPlaybackRun`) -> playback executor -> sink -> device.

| Piece | Where | Role |
| --- | --- | --- |
| Mix graph | `media/node/ffmpegPlanner.ts` `buildAudioMixGraph`, `planFfmpegAudioStream` | The export mixer graph (per-clip `atrim`, resample to 48 kHz stereo, mono duplicated, gain/pan, `adelay`, `amix`) for a window from the cursor, written as f32le to stdout. Export uses the same function. |
| PCM stream | `media/node/audio/ffmpegPcmSource.ts`, `MediaService.streamAudioMix` | ffmpeg stdout as a pull `PcmSource`; the pipe is paused above 1 s buffered (backpressure by demand); cancel kills the process tree. |
| Sink | `media/node/audio/audioSink.ts` | One master gain, one gain per play (5 ms stop ramp), 20 ms `AudioBufferSourceNode` chunks on the sample grid, 100 ms lookahead. Late data is dropped from the stream head so stream position equals the device clock. |
| Clock | `media/node/audio/audioPlaybackClock.ts` | `PlaybackClock` over `currentTime - median(outputLatency)`, interpolated with the system clock, smoothed, monotonic, hard resync above 40 ms. |
| Mix descriptor | `ui/gpuix/host/audioMixController.ts` | Resolves the audio clips of the declared plan inputs to files and probed channel counts once per plan revision. Fed by the same `updatePlan` the preview uses. |
| PCM cache | `media/node/audio/pcmMixCache.ts`, `filePcmSource.ts` | Renders the whole mix once per mix revision to `<profile>/cache/audio-mix/` (wiped on start); seeks read the file. |
| Composition | `ui/gpuix/host/desktopAudio.ts`, `playbackExecutor.ts`, `app/startRealHost.ts` | Sink + clock + cache on one `AudioContext`; the executor starts sound for each new run at the presented cursor. |

Behaviour:

- Audio is master. `PlaybackRuntime` runs on the audio clock; the cursor and the video presenter follow
  it (frames dropped or repeated, audio never stretched). Audio start: the stream opens at
  `cursor + 20 ms start lead + output latency`, so the first scheduled sample is the one the cursor
  reaches when it is heard.
- A new run (play, seek while playing, rate change) restarts the sound at the presented cursor; the same
  run id re-applied (boundary change) leaves it running; pause and boundary stop it with the 5 ms ramp.
  Resume is a new run.
- Only rate 1 is audible. Other rates play silently on the same clock (no time stretching).
- Edits while playing: when the audio part of the plan changes (clip move, gain, trim, volume) the mix is
  re-resolved, the cache re-rendered, and sound restarts at the presented cursor (the direct stream is used
  until the cache is one second ahead). Video-only edits do not touch audio.
- No device at startup, or a device that is suspended or lost: the clock falls back to the system clock
  (the run is re-anchored on the switch) and playback continues silently; sound restarts when the device
  is back. `MINICUT_AUDIO=off` never opens the device (`startRealHost` option `audio: "off"`).
- DKT model and protocol are unchanged. The effect payload still carries the run only; the mix is
  host-resolved from the declared plan attrs, like the preview source.
- Master volume is `AudioSink.setMasterGain` (applies immediately, after the lookahead); the model has no
  volume attr yet, so nothing calls it. Per-track gain and mute are baked into the mix like export.

### Seek, pause, resume measurements

`scripts/audio-spike/measure-seek.ts` (bun, real device): 120 s timeline of 60 audio clips, 8 seeks,
seek call to non-zero sample at an `AnalyserNode` after the sink (includes the 20 ms start lead).

| Path | median | max |
| --- | --- | --- |
| Direct ffmpeg stream (respawn per seek, 60 inputs) | 485 ms | 635 ms |
| PCM cache | 16 ms | 18 ms |

The cache renders the 120 s mix in 1.9 s. Seek target (< 100 ms to sound) is met once the cache holds the
position; before that (first seconds after load or after an edit) seeks use the direct stream.

### Tests

- `audioSink.test.ts` (fake context): scheduling grid, lookahead, late-data realignment, stop ramp, end, errors.
- `audioSink.render.test.ts`: the real `OfflineAudioContext` renders the sink output sample-exactly across chunk joins.
- `audioPlaybackClock.test.ts`: monotonic, follows a slow audio clock, latency, freeze, `PlaybackRuntime` on top.
- `ffmpegPcmSource.test.ts`, `pcmMixCache.test.ts`: backpressure, cancel, errors, growing-file reads, replacement.
- `mediaService.audioStream.media.test.ts`, `audioParity.media.test.ts` (ffmpeg): stream length/offset/cancel, and
  stream vs decoded export windowed RMS (per channel, from 0 and from a seek position).
- `playbackExecutor.test.ts`, `desktopAudio.test.ts`, `audioMixController.test.ts` (bun): run/sound
  lifecycle, clock switching, cache use, mix resolution.

### Not verified / open

- Clicks, glitches and A/V alignment by ear; numbers above are API counters, offline renders and device-clock
  measurements. Residual offset is about +-13 ms (`outputLatency` is a hint).
- Device hot-swap, sample-rate change (the context is opened at 48 kHz and rejected otherwise).
- Native addon inside a `bun build --compile` binary (sidecar `.node`).
- The same run re-applied by the model (boundary change) re-anchors the cursor from the epoch clock, not the
  audio clock: a step of up to the audio/system drift (about 63 ppm, 19 ms per 5 min) between cursor and sound.
- Large timelines: the cache file is 23 MB per minute of timeline.
- `scripts/audio-spike/` stays as measurement tooling (stream, drift, gap, seek scripts and `measure-seek.ts`);
  they are not part of any test run.

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

## Plan that was implemented

The spike proposed five commits (sink, PCM stream, clock, seek, tests/docs); they landed as described in
"What shipped" above.

A/V sync policy: audio is master. The cursor is timeline time derived from the audio clock
(`currentTime - outputLatency`); the video presenter follows the cursor: it shows the frame for the
current cursor and drops or repeats frames when it falls behind, never time-stretches audio. Clip
offsets are applied only when mapping the cursor to source time. Pause uses the presented cursor
(existing behaviour) and stays consistent because the same clock produced it. When the audio context
is suspended or absent (headless, no device), fall back to the system `PlaybackClock`.
