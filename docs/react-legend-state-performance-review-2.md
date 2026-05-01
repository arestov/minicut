# React & Legend-State Performance Review (Post-Optimizations)

**Date**: May 2026
**Context**: Reviewing the React rendering pipeline and Legend-State reactivity usage after the optimizations introduced in commits `78fe26c`, `0e43304`, `c98714b`, and `a615489`.

## 1. Summary of Improvements Achieved

The recent refactoring successfully addressed the most critical O(n) graph scans and broad component re-renders. 

1. **`playbackDuration$` is now O(1) during playback**: Prevents scanning the entire timeline graph 60 times a second.
2. **Timeline Header Isolation**: The `CurrentTimeLabel` and `TimelinePlayhead` components have been extracted into localized `observer` components. `TimelineView` itself no longer re-renders every frame.
3. **Pure Renderer Prop-Drilling**: `RendererStage` is fully decoupled from Legend-State's `observer` and takes a pure data `scene` prop.
4. **`PreviewPanel` Sub-Observers**: The transport controls and playback controls are now separated into localized observers (`PreviewTransport`, `PreviewPlaybackButton`, `PreviewStage`). The main layout and headers no longer re-render at 60fps.
5. **O(1) Inspector Selections**: `Inspector` uses a `computed` selector to locate the selected clip's track configuration, re-rendering only when the selection or track topology genuinely changes.
6. **Narrow Row-Level Subscriptions**:
   - `MediaBin`: `ResourceRow` subscribes only to `kind`, `name`, `url` fields, rather than listening to deeply nested attributes mutating independently.
   - `TrackRow`: `TrackLane` utilizes `createTrackEnd$` (which derives lane width without triggering on clip moves), and `ClipListItem` resolves its selected state via a stable `computed` flag instead of re-rendering all sibling clips when selection moves.

## 2. Current Reactivity Architecture Analysis

### Derived Data Layer (`derivedTimeline.ts`)
The derived layer successfully shields the UI from over-rendering by encapsulating complex structural lookups into `computed` properties.

- **Stable References**: `activeClipRefs$` implements manual equality checking (`sameTimelineClipIntervalList`), which successfully prevents structurally-identical array references from propagating to downstream effects.
- **Problem**: `renderedClips$` has `session$.cursor.get()` inside its `computed` block. As a result:
  - This computed node invalidates and re-runs on every frame (60 times a second).
  - It generates fresh `RenderedClip` objects unconditionally, generating a new `filters` array, new `transform` objects, and a new `renderedClips` array on every single tick.
  - This propagates upwards: `visualRenderedClips$`, `audioRenderedClips$`, `activeClipNames$`, and `canvasClips$` all generate new arrays every frame during playback.

---

## 3. Remaining Bottlenecks by Severity

### Bottleneck A: RendererStage Effect Thrashing (Severity: High)
Because `canvasClips` and `renderedClips` arrays have new reference identities every frame (due to `createPreviewScene$`), the `useEffect` blocks in `RendererStage.tsx` completely fail to memoize.

```tsx
// RendererStage.tsx
	useEffect(() => {
        // ... layout thrashing ...
		const width = canvas.clientWidth || 640
		const height = canvas.clientHeight || 360
        // ... postMessage ...
	}, [cursor, canvasClips, renderedClips]) 
```

**Impact:** Every 16ms, React tears down and rebuilds the effect logic, doing synchronous layout reads (`canvas.clientWidth`) and firing unnecessary messages to the offscreen worker. This causes significant GC pressure and frame drops.

### Bottleneck B: `useMemo` in PreviewPanel (Severity: Medium)
In `PreviewPanel.tsx`, `previewScene$` is instantiated via `useMemo` depending on `[projects$, session$]`. However, since `session$` never changes reference, the observable chain lives for the duration of the component.
While `PreviewPanel` is no longer fully wrapped in `observer`, `PreviewTransport` is an `observer` that reads `scene$.cursor.get()`. While functionally correct, having `cursor` injected into `createPreviewScene$` strictly couples the pure data definition of "which tracks exist" with the "playhead iteration" phase.

### Bottleneck C: Clip Drag State (Severity: Low)
In `ClipItem.tsx`:
```tsx
const [dragPreviewDeltaPx, setDragPreviewDeltaPx] = useState(0)
```
Local `useState` for highly-fluid pointer moves during drag triggers React component diffing logic at the event loop bound, which is inherently slower than using direct DOM `style.transform` refs or Legend-State `useObservable` specifically bound to `style` props. For simple components it's fine, but if a timeline scales to 1,000 clips, it may produce micro-stutters during drag.

---

## 4. Recommendations for Next Steps

To achieve steady 60fps playback without unnecessary compute cycles, the remaining work should target the separation of **structural data** from **continuous frame metadata**.

1. **Decouple Cursor from Derived Data Pipeline**:
   - `session$.cursor` changes continuously. `clipIntervals$` changes infrequently.
   - We should stop storing the *interpolated transformed values* in standard React prop pipelines. 
   - Instead of passing `cursor` down the wire, pass the *time definitions* and calculate transforms directly inside `RendererStage` or Offscreen Canvas worker frame ticks.
2. **Move Local React Form State to Observables**:
   - Use `useObservable` or `useComputed` for `dragPreviewDeltaPx` in `ClipItem` combined with a direct `<motion.div>` or `<Element as={observer.div}>` bound property.
   - This bypasses standard React VDOM reconciliations entirely for high-frequency drag events.