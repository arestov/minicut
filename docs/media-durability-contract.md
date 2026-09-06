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

On import MiniCut attempts to create an OPFS project copy before falling back
to a linked-only resource. DKT stores only the serializable descriptor
(`assetStorageKind`, logical `assetRef`, fingerprint and version); it never
stores OPFS handles or paths. The committed layout is
`projects/{projectId}/assets/{resourceId}` with a manifest written last, so an
interrupted temporary write is never visible as an asset.

The original source remains handle-backed independently:

- DKT stores resource metadata and a stable source reference.
- A browser side channel stores `FileSystemFileHandle` objects keyed by
  resource id.
- On reload, MiniCut first resolves the project copy and creates a fresh object
  URL. Only when no copy exists does it query the original handle.
- `prompt` becomes `needs-permission` and never triggers a permission dialog at
  boot. `denied` becomes `permission-denied`; neither state deletes the handle.
- `Grant access` calls `requestPermission()` on the cached handle. Locate and
  Replace are separate picker-based operations.

The side channel stores handles only. It must not store `Blob`,
`ArrayBuffer`, typed arrays, media chunks, thumbnails, waveform data, or copied
file bytes.

## Missing Media

If a project graph restores but the local handle is absent or permission is not
available, MiniCut should keep the project and timeline intact and show an
explicit missing or reconnect state for the affected resource.

The graph remains editable and preserves clips, effects, and timing even when
no local media bytes are available.

## Safe relink and replacement

Locate accepts a candidate automatically only when `isSameEntry()` or a
same-version content fingerprint proves identity. Matching name, size, or
duration is not identity evidence. Replace may accept a technically compatible
different source only after explicit confirmation. A candidate shorter than
`max(clip.in + clip.duration)` (with at most a two-frame tolerance), or with an
incompatible kind/stream topology, is rejected before storage changes.

Relink uses operation ids and commits side-channel storage before one DKT
completion action. Failed or stale operations retain the prior handle, project
asset, runtime URL, and graph metadata.

## Scope and data loss

OPFS and the handle database are origin/profile-local. Clearing site data can
delete both. A project copy is not a portable project bundle and is not
replicated to another browser or device.
