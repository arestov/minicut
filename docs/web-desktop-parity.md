# Web/desktop parity suite

An automated check that the GPUIX desktop app behaves like the web app for the
same user scenario. It is test-only: it changes no product behaviour.

## What it does

One scenario, `tests/parity/sharedScenario.ts`, is a list of steps (data):

1. import `av.webm` (VP9/Opus with audio), `blue.webm` (silent), `card.png`,
   `vfr.webm` (variable frame rate);
2. place the rest on the timeline;
3. trim the head of `av` by an off-grid amount, move `blue` over it and trim
   its tail, trim the head of `vfr`, set volume 0.5 on the embedded audio, select
   a clip;
4. `setCursor`, `play`, `pausePlayback { cursor }` (known cursor, no timing);
5. preview pictures at eight cursors (gap, off-grid in-point, layered, top clip
   only, empty, image, VFR trimmed, VFR late);
6. export the whole project; set clip opacity to 50 percent; capture the preview;
   export again.

Both platforms walk the same steps through their own runtime path and write
artifacts (a manifest of normalised snapshots, PNG pictures, exported files) to
`tmp/parity/<platform>/` (gitignored):

| Platform | Driver | Path |
| --- | --- | --- |
| web | `tests/integration/web-desktop-scenario.spec.ts` (Playwright) | file input import, model actions through the debug bridge, rendered stage picture, toolbar export |
| desktop | `src/ui/gpuix/parity/desktopScenario.test.ts` (bun test) | real host (DKT worker on LevelDB, asset registry, ffmpeg media service, import and playback executors; no window, audio off), native-dialog import path, model actions, Node preview controller, export executor |

`tests/parity/webDesktopParity.compare.test.ts` (vitest) compares the artifacts:

- **state**: the snapshot at every checkpoint (`imported`, `placed`, `edited`,
  `playing`, `paused`, `opacity`) is built from the page graph dump by the same
  function on both sides and compared field by field (`snapshotDiff.ts`). Ids,
  titles, urls, asset refs, availability and recovery state are not part of it.
  Times match within 0.02 s.
- **preview pictures**: SSIM of the picture box (the 4:3 fixture picture inside
  each stage, 2 percent inset to drop the web stage outline, both averaged down
  to 320x240). A second check scores each platform's picture against the
  neighbouring source frames and asserts which source frame it shows: desktop
  exactly the frame the timeline time selects, web within one frame (a media
  element is seeked within a tolerance).
- **export**: ffprobe metadata (size, fps, duration, frame count, audio format),
  SSIM and PSNR of frames at eight timestamps, overall and tone-window RMS, and
  integrated loudness (EBU R128).

## How to run

```powershell
$env:BUN_BIN = "C:/Users/<you>/AppData/Local/Microsoft/WinGet/Packages/Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe/bun-windows-x64/bun.exe"
node scripts/run-web-desktop-parity.mjs            # web, desktop, compare (about 2 minutes)
node scripts/run-web-desktop-parity.mjs desktop compare   # any subset, in order
```

Needs ffmpeg/ffprobe (`MINICUT_FFMPEG_PATH`, `MINICUT_FFPROBE_PATH` or PATH), a
Playwright Chromium, and Bun. The scenario runs serially and opens no GPUIX
window. The compare step writes `tmp/parity/report.json` and prints a
`PARITY-REPORT` line with every measured value. The web spec also runs with the
other Playwright integration specs; the desktop half is part of the GPUIX
headless suite (`node scripts/run-gpuix-tests.mjs`).

## Thresholds

| Check | Threshold | Measured (reference machine) |
| --- | --- | --- |
| state | equal; times within 0.02 s; gain, opacity, fades exact (0.001) | no differences |
| preview SSIM | >= 0.97 | 0.9808 off-grid trim, 0.9809 / 0.9810 VFR, 0.999999 flat colour |
| preview SSIM, `image` | >= 0.95 | 0.9687: `card.png` is 160x120 and is magnified about 7x, the browser (GPU bilinear) and swscale (bicubic) soften edges differently |
| empty frame | desktop flat `#09090b` SSIM >= 0.97 | 0.9994 (the web writes "No frame at cursor" instead) |
| shown source frame | desktop offset 0, web offset within 1 | both 0 |
| export frame SSIM | >= 0.97 | 0.9945 to 0.99998 (PSNR 41 to 56 dB) |
| export RMS | within 1 dB | 0.001 dB overall, 0.005 dB on the tone window |
| export LUFS | within 1 | -28.1 on both |
| export duration / frames | within 0.1 s / 2 frames | 7.960 s vs 7.974 s, 239 vs 239 frames |

Preview SSIM of testsrc2 frames is limited by the two scalers (a browser upscales
the 320x240 source about 3.5x, swscale 2.25x), not by the picture content: a
neighbouring source frame scores 0.02 to 0.05 lower in the neighbour check.

## Known differences

- **Clip opacity** is not supported by the Node preview and exporter (documented
  limit of `ffmpegPlanner`, also text, effects, transform and fades). The
  `image-half-opacity` frame and the `with-opacity` export record the desktop
  error (`FFmpeg export does not support: opacity`) while the web renders and
  exports. The parity assertions for them use `it.fails`: the suite turns red
  when the desktop gains opacity, and the entry in `KNOWN_DESKTOP_GAPS` must be
  removed then.
- **Silent video, no embedded audio clip**: `blue.webm` has no audio stream. Both
  platforms detect that at import (desktop: ffprobe stream list; web: a header
  sniffer, `media/audioStreamSniffer.ts`) and store `audioStreams: 0` on the
  resource, so placing it on the timeline creates no "Embedded audio" clip on A1.
  Before this, both created an empty clip (the export treated it as silence).
  Projects imported earlier keep such a clip. A container the web sniffer cannot
  read yields an unknown count and the clip is still created.
- **Empty cursor**: the web stage shows a "No frame at cursor" text, the desktop
  the plain `#09090b` background.
- **Still images** were imported with zero length on desktop and could not be
  placed on the timeline; fixed (one second, as on the web).

## Not covered

- Sound by ear. The GPUIX PCM mix stream is not compared with the export audio.
- Real windows, DPI and focus behaviour (see the GPUIX window smoke tests).
- Web preview of clips with transform, effects, text or fades against the
  desktop (the Node pipeline reports them as unsupported).
- Scrub proxies (the preview here decodes the originals), collaboration and
  CRDT sync, reopening a workspace.
- Frame-by-frame timing during playback; play and pause are compared as model
  state at a known cursor.
