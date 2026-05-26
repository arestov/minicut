# DKT Skeleton Race — Render Tree Audit (2026-05-08)

## What is the skeleton race?

When a new node is added to a relation (e.g. a Clip added to a Track's `clips` rel),
the DKT sync protocol sends **two separate messages**:

```
Worker → Page
  1. syncType=5 (UPDATE)  — rel is updated, clip node-id appears in `clips`
     → React renders ClipItem with scope set, but attrs not yet arrived
  2. syncType=5 (UPDATE)  — attrs payload arrives (~10–30 ms later)
     → React re-renders ClipItem with real start/duration/name values
```

Between message 1 and message 2 every component that reads attrs from the new scope
sees **null** for every attr.  Without a guard this produces a **skeleton frame** where:

- `Number(null) === 0` → clip positioned at `left: 0px`
- `Math.max(36, 0 * zoom) === 36` → clip width = 36px (resize handle = 28% of clip)
- A 36-px-wide clip at left 0 may visually overlap an existing clip **and be clickable**
  in Playwright tests before attrs stabilise.

---

## Component risk matrix

```
TimelineView
 └─ TrackRow (per track)
     ├─ TrackLabel          ← reads: name, kind, muted, locked
     │    Risk: String(null) = "null" in label. LOW — cosmetic only.
     │    Fix: none needed (string rendering, not positional)
     │
     └─ TrackLane           ← useMany('clips')
          └─ ClipItem       ← reads: start★, duration★, name, sourceClipId, in, opacity, color
               Risk: HIGH ★ — start=null→0 positions clip at left:0; duration=null→36px
               Fix: ✅ early-return guard added (skeleton → return null)
               Secondary: effectScopes = useMany('effects') — if an effect node appears
               before its kind attr, ClipGradeBadge sees kind=null → renders nothing.
               Risk: LOW — only cosmetic.

MediaBin
 └─ ResourceRow             ← reads: sourceResourceId, name, kind, mime, duration★, url, size
      Risk: MEDIUM — duration=null → displays "0.0s" in meta label until attrs arrive.
      Fix: add `if (resourceAttrs.name == null) return null` guard OR
           render duration as resourceAttrs.duration != null ? ... : '—'

InspectorClipHeader
 └─ reads: sourceClipId, name, color, start★, duration★
      Risk: MEDIUM — shows "0s / 0s" briefly when inspector opens on newly-added clip.
      Fix: `if (attrs.start == null || attrs.duration == null) return <InspectorSkeleton />`

InspectorEditTabPanel
 └─ reads: sourceClipId, opacity, in, fadeIn, fadeOut, duration★, start★, transform, color
      Risk: MEDIUM — same as InspectorClipHeader.
      Fix: same pattern.

InspectorAudioTabPanel
 └─ reads: audio, mediaKind  (via useOne('resource') → reads: kind)
      Risk: LOW — audio gain/pan null → sliders show 0. Not positional.

InspectorColorTabPanel
 └─ effectScopes = useMany('effects')
     └─ ColorCorrectionEffect  ← reads: sourceEffectId, enabled, params
          Risk: LOW — if enabled=null → badge hidden, params=null → controls disabled.
```

---

## Data-flow diagram

```
Worker (SharedWorker)
│
│  addResourceToTimeline action dispatched
│
│  Step 1 — create Clip node, push into Track.clips rel
│  ┌──────────────────────────────────────────────────────────────────────┐
│  │ syncType=5: { op: 'setRel', nodeId: <track-id>, rel: 'clips',       │
│  │               value: [<clip-id>] }                                    │
│  └──────────────────────────────────────────────────────────────────────┘
│         ↓ ~0ms
│  Page replica: clips rel = [scope(<clip-id>)]
│  React: renders <ClipItem> with scope=<clip-id>, ALL attrs = null
│  → ClipItem start==null → ✅ return null  (after fix)
│
│  Step 2 — set Clip attrs: start, duration, sourceClipId, name, …
│  ┌──────────────────────────────────────────────────────────────────────┐
│  │ syncType=5: { op: 'setAttrs', nodeId: <clip-id>,                    │
│  │               attrs: { start: 1.6, duration: 1.6, … } }             │
│  └──────────────────────────────────────────────────────────────────────┘
│         ↓ ~10–30ms after step 1
│  Page replica: clip attrs populated
│  React: re-renders <ClipItem> with real values
│  → ClipItem renders at correct left: 89.6px
│
```

---

## Places where `readyAttr` on `<Many>` should be added

| Component | Relation | `readyAttr` |
|-----------|----------|-------------|
| `TrackLane` (TrackRow.tsx) | `clips` | `"start"` |
| `MediaBin` ResourceList | `resources` | `"name"` |

Example usage:
```tsx
// TrackLane — clips ready only when start has arrived
<Many rel="clips" item={ClipItem} readyAttr="start" />

// MediaBin — resources ready only when name has arrived  
<Many rel="resources" item={ResourceListItem} readyAttr="name" />
```

`readyAttr` on `<Many>` defers the *entire ClipItem subtree* until the named attr is
non-null, which is an alternative to the in-component null check.  Both are applied
for maximum safety: `<Many readyAttr>` prevents the mount entirely; the `ClipItem`
guard is a belt-and-suspenders for cases where `ClipItem` is used outside `<Many>`.

---

## Recommended next fixes (not yet applied)

1. `InspectorClipHeader` — show skeleton when `start == null`
2. `InspectorEditTabPanel` — show skeleton when `start == null`
3. `MediaBin` ResourceRow — show `'—'` for duration when `duration == null`
4. `TrackRow.tsx TrackLane` — add `readyAttr="start"` to `<Many rel="clips">`
   (belt-and-suspenders on top of the ClipItem null-check)
