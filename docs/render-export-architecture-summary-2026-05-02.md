# Render and Export Architecture Summary

Rendering is good and stable because MiniCut separates project state, frame planning, frame drawing, audio mixing, encoding, muxing, and fallback diagnostics instead of coupling export correctness to real-time playback.

Web video editors often fail on the same problems: MediaRecorder timing drift, missing WebM duration metadata, silent audio tracks, browser-specific codec support, seek latency, resource leaks, and exports that look correct in the UI but are never validated as real media files.

## SharedWorker and Render Flow

The SharedWorker is the project authority: UI actions become domain commands, commands are validated and converted to patch envelopes, and every tab receives the same registry snapshot/patch stream.

Render is downstream from that authority: the UI exports a plain `ProjectRegistry` snapshot, resolves an `ExportRange`, compiles editframe clips for structural export data, compiles per-frame operations for each timestamp, then produces either a WebM video or a JSON manifest with diagnostics.

Current export rendering runs on the browser page, not in a dedicated render worker; the existing pure render-plan and export-request boundaries make worker migration realistic, but DOM-only pieces such as `document.createElement('canvas')`, `HTMLVideoElement`, `AudioContext`, object URLs, progress/download plumbing, and MediaRecorder fallback would need browser-worker equivalents or a split main-thread adapter.

## Legend State Usage

Legend State is used as a reactive UI mirror of the authoritative registry, with patches applied in batches and tab-local session state kept separate from shared project state.

The strongest choice is the structure/scene split: cursor-independent preview structure is derived once from project topology, while cursor-dependent scene evaluation is kept small enough for playback and scrubbing.

This works well because the UI subscribes to narrow observable slices, while the render/export path consumes deterministic plain data and does not depend on React render timing.

## Modern Export Path

The modern path uses WebCodecs plus `webm-muxer`: video frames are drawn at exact timestamps, encoded with `VideoEncoder`, audio clips are decoded and mixed into Float32 PCM offline, encoded with `AudioEncoder`, and both tracks are muxed into one WebM.

That avoids the classic web-editor trap where export quality depends on whether the page can play a timeline smoothly in real time.

## Fallback Path

The fallback path uses canvas capture plus MediaRecorder when WebCodecs is unavailable or unusable, then patches WebM duration metadata with `fix-webm-duration`.

If video export is unsupported or audio mixing fails in a way that cannot safely produce media, the renderer falls back to a JSON manifest with diagnostics instead of silently returning a broken video.

## Test Coverage Summary

| Area | Current coverage | Strength | Remaining gap |
| --- | --- | --- | --- |
| Render planning | Unit tests cover deterministic frame operations, operation ordering, keyframes, fades, muted tracks, editframe clip structure, and linked audio clip metadata. | Good | More randomized/project-scale combinatorial tests would catch unusual overlap, trim, track, and effect combinations. |
| JSON manifest export | Unit tests cover project and clip ranges for video, image, and audio; frame samples; progress events; project fps defaults; diagnostics; linked audio in selected clip export. | Good | Manifest schema compatibility tests would help once the format becomes external or versioned. |
| Modern WebCodecs export | Integration tests export real WebM artifacts with image plus WAV audio, embedded video audio, selected linked audio, trims, gain, overlapping audio, gaps, visual layering, opacity, fades, transforms, and tint effects. | Strong | Browser matrix coverage is still limited; codec support differs across Chromium, Firefox, Safari, and OS builds. |
| MediaRecorder fallback | Forced fallback test disables WebCodecs and verifies exported audio survives even without `requestFrame`. | Moderate | Needs more parity cases against WebCodecs: trim, selected linked audio, gaps, overlap, gain, and visual effects through fallback. |
| Audio correctness | ffmpeg decodes PCM; tests check RMS, peak, silence windows, frequency energy, gain ratios, linked embedded audio, selected range isolation, and overlap mixing. | Strong | Pan/channel balance checks are not yet as explicit as gain/frequency checks. |
| Video correctness | ffmpeg samples exported frame pixels; tests check color, opacity layering, fade behavior, transform movement, and tint effect. | Good | Needs more frame-time sampling around clip boundaries and transitions. |
| File-level media validity | ffprobe checks video/audio stream presence, duration, dimensions, channels, and analyzable output. | Good | Add strict container checks for duration metadata, codec names, timestamps, and seekability. |
| Failure diagnostics | Tests cover unsupported video export fallback and bad audio source fallback to diagnostic manifest. | Good | Add tests for partial asset load failure, encoder failure, muxer failure, and cancellation/cleanup. |
| Performance and scale | Render-index projection has a benchmark; export tests use small artifacts. | Basic | Add long timeline, many clips, many overlapping audio clips, high fps, and larger resolution export stress tests. |
| Combinatorial coverage | Unit and E2E cases cover many hand-picked combinations. | Moderate | Property-based or generated project tests should combine range type, media kind, trim, mute, linked audio, overlap, effects, keyframes, and fallback backend. |

## Why This Is Better Than A Naive Web Exporter

A naive web video editor records its own preview with MediaRecorder and hopes that playback, audio, canvas drawing, and browser scheduling stay aligned; MiniCut instead treats export as a deterministic data pipeline, with real media-file analysis in tests to verify the artifact rather than only the UI state.