# DKT render tree + attrs + action routing audit (2026-05-06)

## Render tree (current page runtime scope traversal)

- Session root
  - rel `activeProject` -> `Project`
  - rel `selectedClip` -> `Clip | null`
  - attrs read by UI: `activeProjectId`, `selectedEntityId`, `cursor`, `timelineZoom`, `timelineTool`, `snappingEnabled`, `activeInspectorTab`, `previewStructure`, `previewFrame`, `selectedClipSummary`, `selectedClipTrackPosition`
- Active project (`Project`)
  - rel `tracks` -> `Track[]`
  - rel `resources` -> `Resource[]`
  - attrs read by UI: `sourceProjectId`, `title`, `fps`, `width`, `height`, `duration`, `timelineDuration`
- Track (`Track`)
  - rel `clips` -> `Clip[]`
  - attrs read by UI: `sourceTrackId`, `kind`, `name`, `muted`, `locked`, `height`
- Clip (`Clip`)
  - rel `resource` -> `Resource | null`
  - rel `text` -> `Text | null`
  - rel `effects` -> `Effect[]`
  - attrs read by UI/render: `sourceClipId`, `sourceResourceId`, `sourceTextId`, `name`, `color`, `mediaKind`, `start`, `in`, `duration`, `fadeIn`, `fadeOut`, `audio`, `opacity`, `transform`
- Resource (`Resource`)
  - attrs read by UI/render: `sourceResourceId`, `name`, `kind`, `url`, `mime`, `duration`, `width`, `height`, `size`, `source`, `status`, `data`
- Text (`Text`)
  - attrs read by UI/render: `sourceTextId`, `content`, `style`, `box`
- Effect (`Effect`)
  - attrs read by UI/render: `sourceEffectId`, `name`, `kind`, `enabled`, `amount`, `params`, `color`

## Action mapping (UI runtime -> model action)

- Session/root scoped
  - `createProject` -> `SessionRoot.createProject`
  - `setActiveProject` -> `SessionRoot.setActiveProject`
  - `selectEntity` -> `SessionRoot.selectEntity`
  - `setActiveInspectorTab` -> `SessionRoot.setActiveInspectorTab`
  - `togglePlayback` -> `SessionRoot.togglePlayback`
  - `setCursor` -> `SessionRoot.setCursor`
  - `tickPlayback` -> `SessionRoot.tickPlayback`
  - `zoomTimeline` -> `SessionRoot.zoomTimeline`
- Project scoped
  - `addTrack` -> `Project.addTrack`
  - `importResource` -> `Project.importResource` (resource create only; first-timeline placement now handled in runtime)
- Track scoped
  - `addClip`, `addTextClip`, `splitClipAt`, `removeClip`
- Clip scoped
  - `rename`, `color`, `updateOpacity`, `setFade`, `setTransform`, `setAudio`, `trim`, `resize`, `splitAt`, `moveBy`, `addEffect`, `removeEffect`
- Text scoped
  - `setTextContent`, `setTextStyle`, `setTextBox`
- Effect scoped
  - `setEffectName`, `setEffectKind`, `setEffectEnabled`, `setEffectAmount`, `setEffectParams`, `setEffectColor`

## Dead attrs removed

- `Clip.trimEnd`
- `Clip.playbackRate`
- `Project.resourceCount`
- `Project.trackCount`
- `Project.exportPlanStatus`
- `Project.timelineSummary`
- `Project.resourceSummary`
- `SessionRoot.activeTool`
- `SessionRoot.selectionKind`
- `SessionRoot.selectedEntitySummary`

## Open contradictions / residual risk

- `SessionRoot.previewStructure` and selected-clip derived attrs are still synchronized by runtime-side traversal (`sync*` actions), not pure model comp rel traversal.
- `addTextClip` selection path still depends on session selected-clip syncing consistency; this is the current instability point in Playwright.
- Full elimination of runtime-side derived synchronization requires moving preview/selected summaries into DKT comp rel/comp attr definitions.
