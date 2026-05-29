# Media Durability Contract

MiniCut separates project graph durability from local media byte durability.

DKT/CRDT storage is responsible for durable project data:

- projects, tracks, clips, effects, text, timing, and resource metadata;
- stable resource identity;
- lightweight source references.

It must not store copied video, audio, or image bytes.

## Object URLs

`blob:` object URLs are runtime-only. They are valid only for the browser
session that created them and must not be treated as durable media references.

Tests that import media through `setInputFiles()` may assert that resource
metadata, clips, and timeline state survive reload. They must not assert that
the original media bytes remain previewable after reload through the old
object URL.

## Durable Local Media

Durable local media is handle-backed:

- DKT stores resource metadata and a stable source reference.
- A browser side channel stores `FileSystemFileHandle` objects keyed by
  resource id.
- On reload, MiniCut asks the handle for a fresh `File`, creates a fresh object
  URL, and uses that URL for the current session.

The side channel stores handles only. It must not store `Blob`,
`ArrayBuffer`, typed arrays, media chunks, thumbnails, waveform data, or copied
file bytes.

## Missing Media

If a project graph restores but the local handle is absent or permission is not
available, MiniCut should keep the project and timeline intact and show an
explicit missing or reconnect state for the affected resource.
