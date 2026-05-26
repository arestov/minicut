# DKT Action Dispatch Migration Plan

Date: 2026-05-06

Goal: eliminate all scope traversal from `createDktActionRuntime.ts`.
Every component dispatches on its local scope via `useActions()`.
Cross-scope routing happens exclusively through DKT model action forwarding
(`to: ['<< rel', { action: 'name', sub_flow: true }]`).

---

## Key patterns

### Direct dispatch (0 hops)

Component has the target scope in `ScopeContext` (via `<One>` / `<Many>` wrappers).
Dispatch directly via `useActions()`:

```tsx
// Inside <Many rel="effects"> → ScopeContext = effect scope
const dispatch = useActions()
dispatch('setEffectParams', { params: { exposure: { value: 0.5 } } })
```

### Session-root forwarding (1 hop via model rel)

Component dispatches on session/root scope. Model forwards through its rel:

```js
// SessionRoot model:
splitSelectedClip: [{
  to: ['<< selectedClip', { action: 'splitSelfAt', sub_flow: true }],
  fn: [['cursor'], (_p, cursor) => ({ time: cursor })],
}]
```

### Parent forwarding (structural parent via `'^'`)

Clip dispatches action that needs to reach parent Track.
Uses `'^'` multiPath address (resolves to structural parent via `getStrucParent(1)`):

```js
// Clip model:
removeSelf: [{
  to: ['^', { action: 'removeClip', sub_flow: true }],
  fn: [['sourceClipId'], (_p, sourceClipId) => ({ clipId: sourceClipId })],
}]
```

If `'^'` does not work at runtime, fallback: add `track: [one, Track]` reverse rel to Clip
and use `['<< track', { action: 'removeClip', sub_flow: true }]`.

### Multi-step walker for split

Clip reads own attrs, trims self, forwards right-side creation to Track:

```js
// Clip model:
splitSelfAt: [
  { to: ['$output'], fn: [['start','in','duration',...], (p, start, inPt, dur, ...) => ({ ... })] },
  { to: { start: ['start'], duration: ['duration'] }, fn: (d) => ({ start: d.left, duration: d.leftDur }) },
  { to: ['^', { action: 'splitClipAt', sub_flow: true }], fn: (d) => ({ ... rightSideAttrs }) },
]
```

---

## Action table

Legend:
- **Hop** = number of scope traversals currently done in runtime code
- **Target scope** = which scope the component should dispatch on
- **Model changes** = what needs to change in DKT models

---

### Session/root actions (0 hops, dispatch on root scope)

| # | Action | Current flow | Pure DKT flow | Component | Model changes |
|---|--------|-------------|---------------|-----------|---------------|
| 1 | `createProject` | harness → root dispatch → SessionRoot.createProject | Toolbar dispatches `createProject({ title })` on root scope via `useActions()` | Toolbar | None — action already exists on SessionRoot |
| 2 | `setActiveProject` | harness → root dispatch → SessionRoot.setActiveProject | Toolbar/ProjectDropdown dispatches `setActiveProject(id)` on root scope | Toolbar, ProjectDropdown | None — action already exists |
| 3 | `selectEntity` | harness → root dispatch → SessionRoot.selectEntity | ClipItem/MediaBin dispatches `selectEntity(id)` on root scope | ClipItem, MediaBin | None — action already exists |
| 4 | `setActiveInspectorTab` | harness → root dispatch | Inspector dispatches on root scope | Inspector | None |
| 5 | `togglePlayback` | harness → root dispatch | PreviewPanel already uses `useActions()` — expand to all playback actions | PreviewPanel | None |
| 6 | `setCursor` | harness → root dispatch | TimelineView dispatches on root scope | TimelineView | None |
| 7 | `tickPlayback` | harness → root dispatch | Playback loop dispatches on root scope | VideoEditorApp (PlaybackLoop) | None |
| 8 | `zoomTimeline` | harness → root dispatch | TimelineView dispatches on root scope | TimelineView | None |
| 9 | `importSampleResource` | harness → root dispatch → SessionRoot.importSampleResource | Session scope dispatch `importSampleResource` | Toolbar (dev) | None — action already exists |

---

### Clip actions (dispatch on clip scope, 0 hops)

All these currently traverse root → selectedClip (1 hop), ignoring the clipId argument.
After migration: component dispatches directly on its clip scope from `ScopeContext`.

| # | Action | Current flow | Pure DKT flow | Component | Model changes |
|---|--------|-------------|---------------|-----------|---------------|
| 10 | `renameClipById` | root → selectedClip (1 hop) → `rename` | clip scope → `rename({ name })` | InspectorEditTabPanel | None — `rename` action exists on Clip |
| 11 | `renameSelectedClip` | root → selectedClip (1) → `rename` | clip scope → `rename({ name })` | InspectorEditTabPanel | None |
| 12 | `colorClipById` | root → selectedClip (1) → `color` | clip scope → `color({ color })` | InspectorColorTabPanel | None |
| 13 | `colorSelectedClip` | root → selectedClip (1) → `color` | clip scope → `color({ color })` | InspectorColorTabPanel | None |
| 14 | `updateClipOpacityById` | root → selectedClip (1) → `updateOpacity` | clip scope → `updateOpacity({ opacityPercent })` | InspectorEditTabPanel | None |
| 15 | `updateSelectedClipOpacity` | root → selectedClip (1) → `updateOpacity` | clip scope → `updateOpacity` | InspectorEditTabPanel | None |
| 16 | `updateClipFadeById` | root → selectedClip (1) → `setFade` | clip scope → `setFade({ edge, delta })` | InspectorEditTabPanel | None |
| 17 | `updateSelectedClipFade` | root → selectedClip (1) → `setFade` | clip scope → `setFade` | InspectorEditTabPanel | None |
| 18 | `updateClipTransformById` | root → selectedClip (1) → `setTransform` | clip scope → `setTransform(partial)` | InspectorEditTabPanel | None |
| 19 | `updateSelectedClipTransform` | root → selectedClip (1) → `setTransform` | clip scope → `setTransform` | InspectorEditTabPanel | None |
| 20 | `updateClipAudioById` | root → selectedClip (1) → `setAudio` | clip scope → `setAudio({ gain, pan })` | InspectorAudioTabPanel | None |
| 21 | `updateSelectedClipAudio` | root → selectedClip (1) → `setAudio` | clip scope → `setAudio` | InspectorAudioTabPanel | None |
| 22 | `trimClipById` | root → selectedClip (1) → `trim` | clip scope → `trim({ edge, delta })` | InspectorEditTabPanel | None |
| 23 | `trimSelectedClip` | root → selectedClip (1) → `trim` | clip scope → `trim` | InspectorEditTabPanel | None |
| 24 | `resizeClipById` | root → selectedClip (1) → `resize` | clip scope → `resize({ edge, delta })` | ClipItem | None |
| 25 | `nudgeSelectedClip` | root → selectedClip (1) → `moveBy` | clip scope → `moveBy({ delta })` | TimelineView | None |
| 26 | `moveClipById` | root → selectedClip (1) → `moveBy` | clip scope → `moveBy` | ClipItem | None |
| 27 | `addEffectToClip` | root → selectedClip (1) → `addEffect` | clip scope → `addEffect({ kind })` | InspectorEditTabPanel | None — `addEffect` exists on Clip |
| 28 | `addEffectToSelectedClip` | root → selectedClip (1) → `addEffect` | clip scope → `addEffect` | InspectorEditTabPanel | None |
| 29 | `addColorCorrectionToClip` | root → selectedClip (1) → `addEffect` kind=color-correction | clip scope → `addEffect({ kind: 'color-correction' })` | InspectorColorTabPanel | None |
| 30 | `addColorCorrectionToSelectedClip` | root → selectedClip (1) → `addEffect` | clip scope → `addEffect({ kind: 'color-correction' })` | InspectorColorTabPanel | None |
| 31 | `removeEffectFromClip` | root → selectedClip (1) → `removeEffect` | clip scope → `removeEffect({ effectId })` | InspectorEditTabPanel | None — `removeEffect` exists on Clip |
| 32 | `removeEffectFromSelectedClip` | root → selectedClip (1) → `removeEffect` | clip scope → `removeEffect` | InspectorEditTabPanel | None |

---

### Effect actions (dispatch on effect scope, 0 hops)

Currently: root → selectedEffect (1 hop), effectId is ignored.
After: component inside `<Many rel="effects">` dispatches directly.

| # | Action | Current flow | Pure DKT flow | Component | Model changes |
|---|--------|-------------|---------------|-----------|---------------|
| 33 | `updateEffectAttrs` (name) | root → selectedEffect (1) → `setEffectName` | effect scope → `setEffectName({ name })` | InspectorColorTabPanel | None — actions exist on Effect |
| 34 | `updateEffectAttrs` (kind) | root → selectedEffect (1) → `setEffectKind` | effect scope → `setEffectKind({ kind })` | — | None |
| 35 | `updateEffectAttrs` (enabled) | root → selectedEffect (1) → `setEffectEnabled` | effect scope → `setEffectEnabled({ enabled })` | InspectorEditTabPanel, InspectorColorTabPanel | None |
| 36 | `updateEffectAttrs` (amount) | root → selectedEffect (1) → `setEffectAmount` | effect scope → `setEffectAmount({ amount })` | InspectorColorTabPanel | None |
| 37 | `updateEffectAttrs` (params) | root → selectedEffect (1) → `setEffectParams` | effect scope → `setEffectParams({ params })` | InspectorColorTabPanel | None |
| 38 | `updateEffectAttrs` (color) | root → selectedEffect (1) → `setEffectColor` | effect scope → `setEffectColor({ color })` | InspectorColorTabPanel | None |

---

### Text actions (dispatch on text scope, 0 hops)

Currently: root → selectedClip → text (2 hops).
After: component inside `<One rel="text">` dispatches directly.

| # | Action | Current flow | Pure DKT flow | Component | Model changes |
|---|--------|-------------|---------------|-----------|---------------|
| 39 | `updateTextById` (content) | root → selectedClip → text (2) → `setTextContent` | text scope → `setTextContent({ content })` | InspectorEditTabPanel | None — actions exist on Text |
| 40 | `updateTextById` (style) | root → selectedClip → text (2) → `setTextStyle` | text scope → `setTextStyle({ style })` | InspectorEditTabPanel | None |
| 41 | `updateSelectedText` (all) | root → selectedClip → text (2) → per-field | text scope → per-field dispatch | InspectorEditTabPanel | None |

---

### Cross-scope forwarding actions (model-level routing)

These require new model actions or forwarding declarations.

| # | Action | Current flow | Pure DKT flow | Component | Model changes |
|---|--------|-------------|---------------|-----------|---------------|
| 42 | `addTextClip` | harness → root dispatch `addTextClipToTimeline` → SessionRoot forwarding chain already works → Project → Track | Session scope dispatch `addTextClipToTimeline` via `useActions()` | Toolbar/TimelineView | **None** — forwarding chain already exists in models |
| 43 | `addTrack` | harness → root → activeProject (1-2 hops) → `addTrack` | **Option A**: Component dispatches `addTrackViaProject` on session scope, SessionRoot forwards to `activeProject.addTrack` via `to: ['<< activeProject', { action: 'addTrack', sub_flow: true }]`. **Option B**: Component inside `<One rel="activeProject">` dispatches `addTrack` directly on project scope. | TimelineView | **Option A**: Add `addTrackViaProject` forwarding action on SessionRoot. **Option B**: None — `addTrack` exists on Project |
| 44 | `addResourceToTimeline` | harness → root → activeProject (1-2) → resource lookup by sourceResourceId → track selection → `addClip` | Component dispatches `addResourceToTimeline({ resourceId })` on **project scope** (available via `<One rel="activeProject">`). Project model resolves correct track, forwards `addClip` to track. | MediaBin (inside `<One rel="activeProject">`) | Add `addResourceToTimeline` action on Project model: reads resource attrs by sourceResourceId from `resources` rel, picks track by kind, forwards to Track.addClip |
| 45 | `importFiles` | harness → waitForActiveProjectScope (1-2 hops) → file handling inline (object URL, duration probe, transfer manager register) → dispatch `importResource` + `addClip` | **Phase 1** (keep in harness): file handling stays in harness, but scope resolution uses project scope from context instead of traversal. **Phase 2** (later): move to `$fx_importFiles` effect on Project model. | MediaBin | **Phase 1**: Shrink harness method to accept `projectScope` param. **Phase 2**: Add `$fx_importFiles` effect on Project |
| 46 | `deleteClipById` | root → selectedClip (1) → `removeClipSelf` (not found in model) | clip scope → `removeSelf` → Clip model forwards to parent Track via `to: ['^', { action: 'removeClip', sub_flow: true }]` | ClipItem | **Add** `removeSelf` action on Clip model (see below) |
| 47 | `deleteSelectedClip` | root → selectedClip (1) → `removeClipSelf` (not found) | **Option A**: Session scope → `deleteSelectedClip` → SessionRoot forwards to selectedClip → Clip.removeSelf. **Option B**: Component gets clip scope from context, dispatches `removeSelf` directly. | TimelineView | **Option A**: Add `deleteSelectedClip` on SessionRoot: `to: ['<< selectedClip', { action: 'removeSelf', sub_flow: true }]`. **Option B**: None beyond Clip.removeSelf |
| 48 | `splitSelectedClip` | root.readAttrs cursor (0) → root → selectedClip (1) → read clip attrs locally → dispatch `splitAt` on clip → dispatch `splitClipAt` on project (action missing) | Session scope → `splitSelectedClip` → SessionRoot reads cursor dep, forwards to selectedClip → `splitSelfAt` → Clip 3-step walker: (1) read own attrs, (2) trim self, (3) forward `splitClipAt` to parent Track | TimelineView | **Add** `splitSelectedClip` on SessionRoot with cursor dep. **Add** `splitSelfAt` multi-step walker on Clip model |
| 49 | `splitClipByIdAt` | root → selectedClip (1), clipId ignored → same as splitSelectedClip | clip scope → `splitSelfAt({ time })` directly | ClipItem | Same `splitSelfAt` on Clip as #48 |

---

### Infrastructure actions (stay in harness for now)

These involve file I/O, task queues, or transfer management that can't be pure DKT model actions yet.

| # | Action | Current flow | Pure DKT flow | Stays in harness? |
|---|--------|-------------|---------------|-------------------|
| 50 | `queueClipExportById` | runtime task dispatch `PROJECT_RENDER_EXPORT_FX` range=clip | Phase 2: clip scope → model action → `$fx_renderExport` | **Yes** (Phase 1). Phase 2: move to model effect |
| 51 | `queueSelectedClipExport` | same, range=clip | Phase 2: clip scope → model action → `$fx_renderExport` | **Yes** (Phase 1) |
| 52 | `queueProjectExport` | same, range=project | Phase 2: project/session scope → model action → `$fx_renderExport` | **Yes** (Phase 1) |

---

## New model actions to implement

### Clip model

```js
// Remove self from parent Track
removeSelf: [{
  to: ['^', { action: 'removeClip', sub_flow: true }],
  fn: [['sourceClipId'], (_payload, sourceClipId) => ({ clipId: sourceClipId })],
}]

// Split self at time: trim left, create right on Track
splitSelfAt: [
  {
    to: ['$output'],
    fn: [
      ['start', 'in', 'duration', 'sourceResourceId', 'sourceTextId',
       'name', 'color', 'mediaKind', 'fadeIn', 'fadeOut', 'audio', 'opacity', 'transform'],
      (payload, start, inPt, dur, srcResId, srcTxtId,
       name, color, mediaKind, fadeIn, fadeOut, audio, opacity, transform) => {
        const splitTime = payload.time
        if (splitTime <= start || splitTime >= start + dur) return '$noop'
        return {
          splitTime,
          leftStart: start,
          leftDuration: splitTime - start,
          rightStart: splitTime,
          rightIn: inPt + (splitTime - start),
          rightDuration: start + dur - splitTime,
          attrs: { sourceResourceId: srcResId, sourceTextId: srcTxtId, name, color,
                   mediaKind, fadeIn, fadeOut, audio, opacity, transform },
        }
      },
    ],
  },
  {
    to: { start: ['start'], duration: ['duration'] },
    fn: (d) => ({ start: d.leftStart, duration: d.leftDuration }),
  },
  {
    to: ['^', { action: 'splitClipAt', sub_flow: true }],
    fn: (d) => ({
      sourceClipId: undefined, // Track action generates ID
      sourceResourceId: d.attrs.sourceResourceId,
      sourceTextId: d.attrs.sourceTextId,
      name: d.attrs.name,
      color: d.attrs.color,
      mediaKind: d.attrs.mediaKind,
      start: d.rightStart,
      in: d.rightIn,
      duration: d.rightDuration,
      fadeIn: 0,
      fadeOut: d.attrs.fadeOut,
      audio: d.attrs.audio,
      opacity: d.attrs.opacity,
      transform: d.attrs.transform,
    }),
  },
]
```

### SessionRoot model

```js
// Delete selected clip via forwarding chain
deleteSelectedClip: [{
  to: ['<< selectedClip', { action: 'removeSelf', sub_flow: true }],
  fn: () => ({}),
}]

// Split selected clip at cursor
splitSelectedClip: [{
  to: ['<< selectedClip', { action: 'splitSelfAt', sub_flow: true }],
  fn: [['cursor'], (_payload, cursor) => ({ time: cursor })],
}]
```

### Project model

```js
// Add resource to timeline: find resource by ID, pick track, forward addClip
addResourceToTimeline: [
  {
    to: ['$output'],
    fn: (payload) => {
      const resourceId = (payload as { resourceId?: string }).resourceId
      if (!resourceId) return '$noop'
      return { resourceId }
    },
  },
  // Step 2: resolve target track and forward addClip
  // (needs read from resources rel to get kind/duration — may need deps or 2-step walker)
  {
    to: ['<< primaryVideoTrack', { action: 'addClip', sub_flow: true }],
    fn: (d) => ({
      sourceClipId: undefined,
      sourceResourceId: d.resourceId,
      name: 'Clip',
      mediaKind: 'video',
      start: 0, in: 0, duration: 1,
    }),
  },
]
```

Note: `addResourceToTimeline` needs access to resource attrs (kind, duration) to pick the
correct track and set proper duration. This may require a multi-step walker that first
reads from the `resources` rel. Alternative: the component reads these attrs via `useAttrs`
on the resource scope and passes them in the payload.

---

## `'^'` parent address — verification needed

The `'^'` multiPath address resolves to the structural parent model via `getStrucParent(1)`.
This is confirmed by the DKT runtime code:

- `ascendor.js:87-91`: `'^'` parses to `{ type: 'parent', steps: 1 }`
- `getBase.js:46`: `return md.getStrucParent(info.steps)`
- `Model.js:129-142`: `getStrucParent` follows `map_parent` chain

**Must verify with a test before implementing.** If `'^'` does not work in the `to:` target
context, fallback to adding a `track: [one, Track]` reverse rel on Clip and using
`['<< track', { action: 'removeClip', sub_flow: true }]`.

---

## Implementation order

1. **Fix headlessScenario.test.ts** — restore `describe.skip`
2. **Verify `'^'` parent address** — write a test that creates Track > Clip, dispatches
   an action on Clip with `to: ['^', { action: ... }]`, confirms it reaches Track
3. **Add `removeSelf` and `splitSelfAt`** to Clip model
4. **Add `deleteSelectedClip` and `splitSelectedClip`** to SessionRoot
5. **Migrate Category A components** (direct scope dispatch) — start with the easiest:
   - Effect panel actions (the user's main pain point)
   - Text panel actions
   - Clip inspector actions
   - Timeline/session actions
6. **Migrate Category B components** (forwarding)
7. **Shrink `createDktActionRuntime.ts`** — remove all traversal helpers, keep only
   `createProject`, `importFiles`, `queue*Export`
8. **Update `actionRuntimeTypes.ts`** — remove all `*ById` methods
9. **Run full test suite** — `tsc --noEmit`, `vitest run`, verify no regressions
