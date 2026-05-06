# DKT hard rewrite target instructions

Date: 2026-05-06

This document describes how to write the new MiniCut editor contour.

The target architecture is Weather/Linkkraft style: DKT owns state and derivation, React traverses top-down, and side effects cross the boundary only through DKT DI, actions, tasks, and effects.

## Reference patterns studied

Weather render uses a streamed session root and starts UI traversal through `pioneer`. `WeatherGraph` renders `One rel="pioneer"`, then `One rel="mainLocation"`, then `Many rel="additionalLocations"`. Concrete scoped components call `useAttrs` only for local model attrs.

Weather components declare shape requirements close to the component. `CurrentWeatherCard` and `ForecastCard` are wrapped with `shapeOf(...)` and read compact attrs such as `temperatureText`, `summary`, and `label`. They do not rebuild forecast or weather objects in React.

Weather models put derived view data in comp attrs. `CurrentWeather.temperatureText`, `CurrentWeather.summary`, `HourlyForecastSeries.label`, `DailyForecastSeries.temperatureText`, `WeatherLocation.hourlySparkline`, and `AppRoot.weatherUpdatedSummary` are DKT-owned derived attrs.

Weather model actions keep workflows inside DKT. `AppRoot.handleInit` creates initial locations, starts effects, and derives main/additional location rels. `SelectedLocationPopoverRouter` uses `inline_subwalker` to replace a weather location from router actions without app-layer await/read chains.

Linkkraft source uses the same architectural shape in older DKT view style. `SessionRootView` exposes `pioneer: AppView`; routers derive current model ids and window state through comp attrs and comp rels. `MainNavigation.runQuery` creates or reuses a search model, writes rel membership, emits `$output`, then navigates in the next inline action step.

## State ownership

Every editor fact has one DKT owner.

Session state belongs to `SessionRoot`: active project rel, selected entity rels, cursor, playback, zoom, inspector tab, import/export task state, and preview mode state.

Project state belongs to `Project`: tracks, resources, timeline settings, selected timeline-derived summaries, resource import state, and project-level render/export plans.

Track state belongs to `Track`: clips, ordering, kind, mute/lock/visibility, track-level timing summaries, and track-level render grouping.

Clip state belongs to `Clip`: timing, trim, source rels, text rel, effects rel, transform, audio attrs, color attrs, and compact render attrs for that clip.

Resource state belongs to `Resource`: media kind, duration, object URL or transfer state, dimensions, audio presence, data readiness, and import errors.

Text and Effect state belongs to `Text` and `Effect`: style attrs, payload attrs, and derived compact render attrs.

## Render traversal

React starts at the streamed DKT session scope.

Use `One`, `Many`, and `Path` to traverse rels. Use `useAttrs` inside the component that owns the current scope. Pass ordinary React props only for presentation options that are not app state, such as `compact`, `active`, `className`, or a callback already bound to the current scope.

The root render tree should be narrow:

1. `SessionRootView` reads session attrs and traverses `activeProject`.
2. `ProjectView` reads compact project attrs and traverses `tracks`, `resources`, and derived panel rels.
3. `TrackView` reads track attrs and traverses `clips`.
4. `ClipView` reads clip attrs and traverses `resource`, `text`, and `effects`.
5. `ResourceView`, `TextView`, and `EffectView` read their own attrs.

If a child needs parent context, prefer a DKT comp attr or comp rel on the child or parent. Pass props only when the value is pure presentation state and not needed by model logic.

## Aggregation rules

Use comp attrs for compact scalar or object view data:

- `Project.timelineDuration` from tracks/clips.
- `Project.timelineSummary` from track counts, clip counts, and duration.
- `Project.previewFrame` or `Project.activePreviewLayers` from cursor and clip render attrs.
- `Track.clipOrderSummary` from clip rel ordering.
- `Clip.renderBox`, `Clip.renderMedia`, `Clip.renderAudio`, `Clip.renderText`, `Clip.effectStackSummary` from local attrs and child rel attrs.
- `Resource.mediaSummary` from kind, duration, dimensions, and readiness.

Use comp rels for derived traversal sets:

- `Project.visibleTracks` from `tracks` filtered by visibility.
- `Project.timelineClips` from all track clips in render order.
- `Project.activeVisualClips` and `Project.activeAudioClips` from cursor and clip intervals.
- `SessionRoot.selectedClip`, `selectedTrack`, `selectedResource`, `selectedText`, and `selectedEffect` from DKT selection state.
- `Clip.visibleEffects` from `effects` filtered by enabled state.

Keep comp attrs compact. If a value becomes a registry-shaped graph, split it into scoped attrs and rels.

## Actions and effects

Use `dispatchAction` for synchronous editor state changes: selection, cursor, playback flags, track create/update/reorder, clip create/update/trim/split/move, text edits, effect edits, resource add-to-timeline, preview mode changes.

Use `dispatchTask` only when runtime-only external work is required: browser `File` handles, object URL creation, media metadata probing, P2P transfer, export rendering, download URL creation, storage, network, or worker compute.

Every task/effect result returns to DKT through a DKT action. Effects do not mutate `projects$`, registry snapshots, or React state directly.

Use inline saga arrays for multi-step model workflows. Use `$output` to pass created or selected models between steps. Use `inline_subwalker: true` when a parent action must call a child action inside the same DKT transaction.

Use `handleInit` for initial model construction that is intrinsic to the model. For MiniCut this includes default project tracks and initial session/project links, not app-layer post-bootstrap reads.

When creating child models through root-routed rels, write the owner rel in the same action with `hold_ref_id` and `use_ref_id`. The render path must observe semantic owner rels, not root rels.

## Tests

Tests must create editor state through DKT actions or DKT task completions.

Tests that read the page sync runtime must bootstrap the page runtime and mount the shapes that declare required attrs/rels.

Tests must assert product behavior: active project exists, imported resource appears, clip is added, preview layer changes, export request completes. They must not assert that a registry snapshot, command patch, or Legend store changed.

During the hard deletion phase, tests may be left failing if their old setup path is removed. Add a comment at the top of the failing test block explaining the behavior contract to rebuild through DKT.

## File placement

Model-owned logic belongs under `src/video-editor/models` and small pure helpers used by those models.

React traversal belongs under component files using DKT React Sync primitives.

Page stream/runtime code belongs under `src/video-editor/dkt/runtime` and `src/video-editor/render-sync` only when it is a strict page-stream adapter.

Boundary adapters belong under app/platform/task/effect modules and must not own editor state decisions.

Pure math helpers may remain in domain/read-model style modules only if they accept explicit DKT-provided data and do not read stores, registries, or runtime ports.