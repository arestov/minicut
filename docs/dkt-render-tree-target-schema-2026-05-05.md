# DKT render tree target schema

Date: 2026-05-05

Purpose: capture the current MiniCut render tree, mark DKT scope boundaries, show which reads already go through `useShape`, and define the complete target shape for removing `EditorRenderRuntime` helpers.

## Legend

- `[session]` is the streamed DKT session root, model `minicut_session_root`.
- `[app]` is `One rel="pioneer"`, model `minicut_app_root`.
- `[project]`, `[track]`, `[clip]`, `[resource]`, `[text]`, `[effect]` are model scopes.
- Correct read path means `RootScope`, `One`, `Many`, `Path`, `useAttrs`, `useOne`, or `useMany` from `src/dkt-react-sync`. These call `useShape` for attrs/rels.
- Incorrect read path means `useEditorAttrs`, `useEditorOne`, `useEditorMany`, `useEditorComp`, direct `runtime.readAttrs` in render code, `debugDumpGraph`, or adapter traversal in `createDktPageEditorRenderRuntime`.
- Correct write path means local `useActions()` under the current DKT scope, forwarded to a DKT model action. No UI-side source-id graph scan.

## Current Top-Level Render Tree

```text
DktEditorRoot
[session] RootScope(runtime)
  MountedShape(miniCutEditorRootShape)       OK: explicit root shape demand
  VideoEditorApp                            BAD: still reads session through Editor helpers
    PlaybackLoop                            BAD: session attrs/actions through Editor helpers
    Toolbar                                 BAD: root attrs/actions through Editor helpers
      ProjectDropdown                       BAD: root/project rels, comps through Editor helpers
    MediaBin                                MIXED: generic DKT reads, legacy writes
      useAttrs([activeProjectId])           OK: shape demanded on [session]
      One(pioneer) -> [app]                 OK: rel shape demanded
        useMany(project) -> [project]       OK: rel shape demanded
          ProjectMediaList
            useMany(resources) -> [resource] OK: rel shape demanded
            ResourceRow.useAttrs(...)       OK: resource attrs demanded
            direct runtime.readAttrs(...)   BAD: filter reads bypass local useShape
    TimelineView                            BAD: active project, tracks, clips, comps via Editor helpers
      useActiveProjectScope                 BAD: wrapper over useEditorOne
      [project]
        activeTimeline virtual scope        BAD: adapter-only rel, not model rel
          [track]
            TrackLabel                      BAD: attrs via Editor helpers
            TrackLane                       BAD: clips rel and trackEnd comp via Editor helpers
              [clip]
                ClipItem                    BAD: attrs/actions/comps via Editor helpers
    PreviewPanel                            BAD: preview read model from legacy store + session Editor helpers
    Inspector                               BAD: selected entity and tabs through Editor helpers
      useSelectedEntityScope                BAD: wrapper over useEditorOne
      [clip]
        InspectorClipHeader                 BAD: clip/resource attrs + trackPosition comp via Editor helpers
        InspectorEditTabPanel               BAD: clip/text/effect attrs/rels/actions via Editor helpers
        InspectorColorTabPanel              BAD: clip/effect attrs/rels/actions; also direct renderRuntime.readAttrs
        InspectorAudioTabPanel              BAD: clip/resource attrs/actions via Editor helpers
        InspectorExportTabPanel             BAD: clip attr via Editor helper; export action via legacy harness
```

## Current Component Read Map

| Component | Scope boundary | Values read | Current path | `useShape` status | Target |
| --- | --- | --- | --- | --- | --- |
| `DktEditorRoot` | `[session]` | root scope, `miniCutEditorRootShape` | `RootScope`, `mountShape` | OK | Keep. Root shape may become smaller after component-level shapes are complete. |
| `VideoEditorApp` | `[session]` | `activeInspectorTab` | `useEditorAttrs` | Missing in component | `useAttrs(['activeInspectorTab'])`. |
| `PlaybackLoop` | `[session]` | `isPlaying` | `useEditorAttrs`, `useEditorActions` | Missing in component | `useAttrs(['isPlaying'])`, `useActions().tickPlayback`. |
| `Toolbar` | `[session]` | `activeProjectId` | `useEditorAttrs(ROOT_SCOPE)` | Missing in component | `useAttrs(['activeProjectId'])`. |
| `ProjectDropdown` | `[session] -> [app] -> [project]` | active project, project list, title, project id, version, resource count | `useEditorOne`, `useEditorMany`, `useEditorAttrs`, `useEditorComp` | Missing | `One(activeProject)` or `One(pioneer)/Many(project)`, project attrs/comps from models. |
| `MediaBin` | `[session] -> [app] -> [project] -> [resource]` | activeProjectId, projects, resources, resource attrs | generic DKT plus direct `runtime.readAttrs` | Mostly OK; direct reads are not OK | Replace direct reads with model comp or child `useAttrs`. Use DKT `useActions`. |
| `TimelineView` | `[session] -> [project] -> [timeline/track] -> [clip]` | cursor, zoom, selectedClipSummary, active project, tracks | Editor helpers | Missing | `One(activeProject)`, `Many(tracks)`, session attrs, selected summary comp. |
| `TrackLabel` | `[track]` | name, kind, muted, locked | `useEditorAttrs` | Missing | `useAttrs(['name','kind','muted','locked'])`. |
| `TrackLane` | `[track] -> [clip]` | clips, trackEnd | `useEditorMany`, `useEditorComp` | Missing | `Many(clips)`, `useAttrs/comp(['trackEnd'])` from Track model. |
| `ClipItem` | `[clip]` plus `[session]` selection | clip attrs, selectedEntityId, edit bounds, color grade flag | `useEditorAttrs`, `useEditorComp`, `useEditorActions` | Missing | clip attrs through `useAttrs`; selected state through `selectedEntityId` or model `isSelected`; comps on Clip/Track models; local `useActions`. |
| `Inspector` | `[session] -> [selectedEntity]` | activeProjectId, activeInspectorTab, selectedEntity | Editor helpers and wrappers | Missing | `One(selectedEntity)` or `One(selectedClip)`, session attrs through `useAttrs`. |
| `InspectorClipHeader` | `[clip] -> [resource]` plus parent track traversal | clip attrs, resource attrs, trackPosition | Editor helpers | Missing | `One(resource)`, `useAttrs`, `trackPosition` model comp. |
| `InspectorEditTabPanel` | `[clip] -> [text/effect]` | clip attrs, text attrs, effects | Editor helpers | Missing | `One(text)`, `Many(effects)`, local model actions. |
| `InspectorColorTabPanel` | `[clip] -> [effect]` | clip color, effects, color correction effect, hasActiveColorGrade | Editor helpers and direct `renderRuntime.readAttrs` | Missing | `Many(effects)` with each effect `useAttrs(['kind'])`, or `One(primaryColorCorrectionEffect)` model rel. |
| `InspectorAudioTabPanel` | `[clip] -> [resource]` | clip audio/mediaKind, resource kind | Editor helpers | Missing | `One(resource)`, `useAttrs`. |
| `InspectorExportTabPanel` | `[clip]` | clip name | `useEditorAttrs`, legacy export action | Missing | `useAttrs(['name'])`, export effect/action rooted in model/session. |
| `PreviewPanel` | `[session]` plus whole project graph | frame, structure, isPlaying, activeInspectorTab | legacy read models and Editor helpers | Missing | Preview frame/structure as model-owned aggregate or explicit DKT read-model bridge with shape demand. |

## Helpers To Delete Or Replace

| Helper/file | What it does now | Why it is wrong for DKT rendering | Delete condition |
| --- | --- | --- | --- |
| `EditorRenderRuntime` | App-specific read/write interface over attrs/rels/comps/actions | It hides shape demand and lets UI read values that were never requested through `useShape`. | No production component imports `../render-sync` hooks. |
| `EditorScopeProvider` / `useEditorScope` | Separate scope context with `EditorScope` | Duplicates `ScopeContext` and keeps legacy source ids/types alive. | All component scope boundaries use `One`, `Many`, `Path`, or `ScopeContext` from generic DKT. |
| `useEditorAttrs` | Subscribes to adapter attrs | Does not call `useShape`; relies on root mounted shape or adapter fallback. | Replaced by generic `useAttrs`. |
| `useEditorOne` | Subscribes to adapter one rel | Does not call `useShape`; supports virtual rels like `activeProject`, `selectedEntity`, `activeTimeline` outside models. | These rels exist on DKT models and UI uses `One`/`useOne`. |
| `useEditorMany` | Subscribes to adapter many rel | Does not call `useShape`; rel naming is adapter-specific (`projects` vs `project`). | UI uses `Many`/`useMany` with real model rel names. |
| `useEditorComp` | Reads adapter comps | Central bug source: comps are computed in TypeScript adapter/legacy registry instead of DKT models. | Every comp in the comp map below exists in a DKT model as attr/comp/rel. |
| `useEditorActions` | Dispatches through adapter and legacy harness actions | Performs source-id lookup and action mirroring in UI adapter. | UI uses generic `useActions`; DKT model action forwarding handles scope. |
| `createDktPageEditorRenderRuntime` | DKT-to-legacy compatibility adapter | Contains graph scans, synthetic rels, legacy comp reads, action mirroring. | No production UI depends on `EditorRenderRuntime`. |
| `createDktEditorRenderRuntime` | Deprecated registry fallback runtime | Computes traversal from legacy registry and subscribes broadly. | Page runtime and DKT model actions are sufficient for render/tests. |
| `useActiveProjectScope` | Wrapper over `useEditorOne('activeProject')` | Looks DKT-like by folder name but still uses bad helper. | Replace by `One rel="activeProject"` or `useOne('activeProject')`. |
| `useSelectedEntityScope` | Wrapper over `useEditorOne('selectedEntity')` | Same hidden traversal problem. | Replace by `One rel="selectedClip"`/`selectedEntity`. |
| `usePreviewReadModels` | Legend/legacy preview aggregate | Not shape-driven and reads the whole registry outside model tree. | Preview aggregate exists as DKT model comp/effect or a consciously isolated non-render bridge with explicit shape contract. |

Yes, `useEditorComp`, `useEditorAttrs`, and the other custom helpers can be removed, but only after the traversal/comp/action map below is moved into models. Removing them before that would just move graph scans into components.

## Values That Need Model Traversal Or Aggregation

| Current value | Used by | Current source | Required model owner | Target read |
| --- | --- | --- | --- | --- |
| `activeProject` | ProjectDropdown, Timeline, MediaBin | Adapter scans `[app].project` using `activeProjectId` | `SessionRoot` owns relation derived from `activeProjectId` and `[app].project.sourceProjectId` | `<One rel="activeProject">`. |
| `selectedEntity` / `selectedClip` | Inspector, ClipItem selected state | Adapter scans graph by `selectedEntityId` | `SessionRoot` owns `selectedEntity`, plus typed rels `selectedClip`, `selectedResource`, etc. | `<One rel="selectedClip">` or `useOne('selectedClip')`. |
| `projectCount` | old tests/dropdown metadata | Adapter counts app projects | `AppRoot.hasProjects` exists; add `projectCount` comp on AppRoot | `useAttrs(['projectCount'])` under `[app]` or avoid if not needed. |
| `projectId` | ProjectDropdown | Legacy comp | Project attr already exists as `sourceProjectId`; no comp needed | `useAttrs(['sourceProjectId'])`. |
| `projectVersion` | ProjectDropdown | Legacy registry project version | Project attr `sourceProjectVersion` or `version` updated during materialization/commands | `useAttrs(['version'])`. |
| `resourceCount` | ProjectDropdown | Legacy comp over project rel | Project comp over `resources` | `useAttrs(['resourceCount'])` on `[project]`. |
| `trackEnd` | TrackLane width | Legacy selector `getTrackEnd` | Track comp over `@all:clips.start` and `@all:clips.duration` | `useAttrs(['trackEnd'])` on `[track]`. |
| `timelineEditBounds` | ClipItem move/resize constraints | Legacy traversal of parent track siblings | Track/Clip model aggregation. Track knows clip order; Clip exposes `timelineEditBounds` through parent track traversal. | `useAttrs(['timelineEditBounds'])` on `[clip]`. |
| `hasActiveColorGrade` | ClipItem, InspectorColor | Legacy traversal of clip effects | Clip comp over `@all:effects.kind` and `@all:effects.enabled` | `useAttrs(['hasActiveColorGrade'])` on `[clip]`. |
| `trackPosition` | InspectorClipHeader | Legacy traversal from clip to parent track | Clip comp or rel-backed comp using `parentTrack` and track clip order | `useAttrs(['trackPosition'])` on `[clip]`. |
| `selectedClipSummary` | TimelineHeader | Legacy session comp over selected clip, resource, track | SessionRoot comp over `selectedClip`, selected clip resource, parent track | `useAttrs(['selectedClipSummary'])` on `[session]`. |
| `colorCorrectionEffectScope` | InspectorColor | Component scans effects with direct `readAttrs(kind)` | Clip rel `primaryColorCorrectionEffect` or Clip comp `hasPrimaryColorCorrection` | `<One rel="primaryColorCorrectionEffect">`. |
| `previewStructure` / `previewFrame` | PreviewPanel, renderer, color scopes | Legacy read models over registry/session | Dedicated Preview model aggregate or AppRoot/Project aggregate driven by active project and cursor | `useAttrs(['previewFrame','previewStructure'])` or a narrow explicit preview bridge. |
| media filter count | MediaBin | Direct `runtime.readAttrs` during render | Project/resource model attrs already exist; filtering should not introduce hidden reads | Resource children call `useAttrs`, or Project exposes `resourceSearchIndex`. |

## Actions That Need Traversal Or Forwarding

| Action | Current caller | Traversal needed | Target model/action organization |
| --- | --- | --- | --- |
| `createProject` | Toolbar, ProjectDropdown, MediaBin empty | none beyond app/session | Session/App action creates project proxy and sets active project. UI calls `useActions()` at `[session]`. |
| `setActiveProject` | ProjectDropdown | project scope/source id | Project row dispatches local `activate` or SessionRoot `setActiveProject(sourceProjectId)`. No graph scan. |
| `importFiles` / `importSampleResource` | MediaBin | active project, import task, resources rel | SessionRoot or Project action/effect forwards to active `[project]`; Project owns `resources`. |
| `addResourceToTimeline` | MediaBin ResourceRow | resource scope -> active project -> target track/timeline | Resource action forwards to active project/timeline, or Project action receives resource rel. UI dispatch is local under `[resource]`. |
| `addTextClip` | MediaBin | active project -> target text/video track | SessionRoot/Project action forwards to active project and track. |
| `addTrack` | Timeline | active project | Dispatch from `[project]` when timeline is under active project; Project action creates/links track. |
| `setCursor`, `zoomTimeline`, `togglePlayback`, `tickPlayback`, `setActiveInspectorTab` | Timeline, Preview, App | session state only | SessionRoot actions. UI dispatch from `[session]`. |
| `select` / `selectEntity` | ClipItem | clip scope -> session selected id | Clip action can forward selected source id to SessionRoot, or UI dispatches SessionRoot `selectEntity(sourceClipId)` with current clip attr demanded. |
| `moveBy`, `resize`, `trim` | ClipItem, inspector | sibling clip constraints | Clip action must use model/track traversal for bounds, not UI comp. Track owns order and constraints. |
| `splitAt` | ClipItem | clip attrs and parent track insertion | Clip action should forward to parent Track `splitClipAt`, or Track action is called from clip through parent relation. |
| `splitSelectedClip`, `nudgeSelectedClip`, `deleteSelectedClip` | TimelineHeader | selected clip -> clip/track/project | SessionRoot action forwards to `selectedClip`; selected clip/track models do the mutation. |
| `rename`, `color`, `setOpacity`, `setFade`, `setTransform`, `setAudio` | ClipItem/Inspector | local clip attrs | Clip model actions already mostly exist; UI should call local `useActions()` under `[clip]`. |
| `addEffect`, `addColorCorrection`, `removeEffect` | Inspector | clip effects rel and effect id/source id | Clip model owns effects; add `addColorCorrection` or `ensureColorCorrectionEffect`; remove by local effect scope or source id. |
| `updateText` | InspectorEdit | text scope | Text model action; UI dispatch under `[text]`. |
| `updateEffect` | InspectorColor | effect scope | Effect model action; UI dispatch under `[effect]`. |
| `queueClipExport`, `queueProjectExport` | InspectorExport, Toolbar | active project / selected clip / project graph | Export should be an explicit effect rooted in SessionRoot/Project/Clip. Until then it is the last acceptable non-render bridge, but not a render helper. |

## Target Render Tree

```text
DktEditorRoot
[session] RootScope(runtime)
  MountedShape(miniCutEditorRootShape or smaller bootstrap shape)
  VideoEditorApp
    useAttrs([activeInspectorTab])
    PlaybackLoop
      useAttrs([isPlaying])
      useActions().tickPlayback
    Toolbar
      useAttrs([activeProjectId])
      useActions().createProject
      export bridge or useActions().queueProjectExport
      ProjectDropdown
        One(activeProject) -> [project]
          ActiveProjectTitle.useAttrs([title])
        One(pioneer) -> [app]
          Many(project) -> [project]
            ProjectItem.useAttrs([sourceProjectId,title,version,resourceCount])
            useActions().activate / SessionRoot.setActiveProject
    MediaBin
      useAttrs([activeProjectId])
      One(activeProject) -> [project]
        ProjectMediaPanel.useAttrs([resourceCount]) optional
        Many(resources) -> [resource]
          ResourceRow.useAttrs([sourceResourceId,name,kind,mime,duration,url,size])
          useActions().addResourceToTimeline
      useActions().importFiles / addTextClip
    TimelineView
      useAttrs([timelineZoom, snappingEnabled, selectedClipSummary, cursor])
      One(activeProject) -> [project]
        Many(tracks) -> [track]
          TrackLabel.useAttrs([name,kind,muted,locked])
          TrackLane.useAttrs([trackEnd])
          Many(clips) -> [clip]
            ClipItem.useAttrs([sourceClipId,name,start,duration,in,opacity,color,timelineEditBounds,hasActiveColorGrade,isSelected])
            useActions().select/moveBy/resize/trim/splitAt
    PreviewPanel
      useAttrs([isPlaying, activeInspectorTab, previewFrame, previewStructure]) or explicit preview model bridge
      useActions().togglePlayback
    Inspector
      useAttrs([activeInspectorTab])
      One(selectedClip) -> [clip]
        InspectorClipHeader
          useAttrs([name,color,start,duration,trackPosition])
          One(resource) -> [resource]
            useAttrs([kind,url,name])
        InspectorEditTabPanel
          useAttrs([opacity,in,fadeIn,fadeOut,duration,start,transform,color])
          One(text) -> [text]
            useAttrs([content,style,box])
            useActions().updateText
          Many(effects) -> [effect]
            EffectEntry.useAttrs([sourceEffectId,name,kind])
        InspectorColorTabPanel
          useAttrs([color,hasActiveColorGrade])
          One(primaryColorCorrectionEffect) -> [effect]
            useAttrs([enabled,params])
            useActions().updateEffect
        InspectorAudioTabPanel
          useAttrs([audio,mediaKind])
          One(resource) -> [resource]
            useAttrs([kind])
        InspectorExportTabPanel
          useAttrs([name])
          export bridge or useActions().queueClipExport
```

## Correct Attribute Organization

The rule is: components ask only for local attrs/rels; traversal and aggregation live in models.

```text
SessionRoot
  attrs: activeProjectId, selectedEntityId, activeInspectorTab, cursor, isPlaying, timelineZoom, timelineTool, snappingEnabled
  rels/comps to add:
    activeProject        = find pioneer.project by sourceProjectId == activeProjectId
    selectedEntity       = find typed model by selectedEntityId
    selectedClip         = selectedEntity if clip
    selectedClipSummary  = selectedClip + selectedClip.resource + selectedClip.parentTrack

AppRoot
  rels: project, track, resource, clip, text, effect
  comps to add:
    projectCount

Project
  attrs to add or materialize:
    version/sourceProjectVersion
  comps to add:
    resourceCount = count(resources)
    trackCount = count(tracks)
  rels/actions:
    tracks, resources already model-owned
    importResource/addTrack should stay on Project or be forwarded here

Track
  rels: clips
  comps to add:
    trackEnd = max(@all:clips.start + @all:clips.duration)
    clipPositions = ordered clip id/name/index data
    clipEditBoundsById = previous/next bounds for child clips

Clip
  rels: resource, text, effects, parentTrack (needed)
  attrs/comps to add:
    mediaKind = source attr or comp from resource.kind fallback
    hasActiveColorGrade = any effects where kind == color-correction and enabled != false
    primaryColorCorrectionEffect = rel to first matching effect
    trackPosition = parentTrack + parentTrack.clips index/name
    timelineEditBounds = parentTrack.clipEditBoundsById[sourceClipId]
    isSelected = SessionRoot.selectedEntityId == sourceClipId, if model can access session; otherwise keep selection as session attr read in component

Resource
  attrs already sufficient for MediaBin and preview: sourceResourceId, name, kind, url, mime, duration, width, height, size, source, status, data

Text
  attrs already sufficient for inspector: content, style, box

Effect
  attrs already sufficient for color controls: sourceEffectId, name, kind, enabled, amount, params, color
```

Important: if a component reads an attr only via `runtime.readAttrs`, the attr may accidentally work because `miniCutEditorRootShape` demanded a large tree, but that is still not a correct dependency. The target is local `useAttrs` or model comp, so the component itself expresses the demand it needs.

## Weather-Style Init, Debug, And Compact Tests

Weather separates startup into three layers:

```text
main.tsx
  createWeatherAppSession()
  bind URL/session key
  session.bootstrap({ sessionKey })
  expose DEV debug object
  render <App session={session} />

page/createWeatherAppSession.ts
  create SharedWorker/transport/P2P bridge
  create page runtime
  expose session facade: runtime, store, bootstrap, dispatchAction, destroy

page/createPageSyncReceiverRuntime.ts
  own ReactSyncReceiver + ShapeRegistry + store
  own debug message ring buffer
  expose debugDescribeNode/debugDumpGraph/debugMessages/getSnapshot
```

MiniCut target should follow the same shape:

```text
app/main.tsx
  createMiniCutEditorSession()
  session.bootstrap()
  window.__minicutSync = { session, dumpGraph, describeNode, messages, snapshot }
  render <VideoEditorHarnessApp harness={session.harness} dktBootstrap={false} />

page/createMiniCutEditorSession.ts
  resolve room URL, signal URL, TURN, media transfer options
  createVideoEditorHarness(...)
  expose page runtime/session facade
  own browser startup policy, not React component render

dkt/runtime/createMiniCutPageSyncRuntime.ts
  keep compact debug helpers as diagnostics only
  keep message ring buffer bounded
```

Testing/debug lessons from Weather:

- use small worker/page runtime clients without rendering React;
- wait on `runtime.getSnapshot().booted && runtime.getSnapshot().ready`;
- assert reset behavior with `runtime.debugDumpGraph()` after session-key switch;
- use `debugMessages().slice(-10)` and graph summaries in repl output instead of full happy-path DOM dumps;
- expose the same debug methods in browser and repl/harness, so a failing test can print `snapshot`, last messages, and graph summary with one helper.

New implementation phases:

| Phase | Goal | Code changes | Tests/debug checks |
| --- | --- | --- | --- |
| 1 | Weather-style session shell and DEV debug surface | Add `createMiniCutEditorSession`, move browser startup policy out of `VideoEditorHarnessApp` entry path, let `main.tsx` own bootstrap/debug/HMR disposal, allow `DktEditorRoot` to skip bootstrap when session already bootstrapped. | Focused type/errors plus page runtime bootstrap test. No UI rewrite yet. |
| 2 | Compact DKT test harness | Add a MemoryWorker/page runtime helper like Weather `createWorkerClient`; wait on runtime snapshot; expose graph/message summaries for failing tests. | New tests for boot ready, session switch graph reset, shape demand path, resource rel streaming. |
| 3 | Replace long DOM waits with DKT probes | Use compact probes before happy-path DOM assertions to separate model streaming bugs from UI rendering bugs. | MediaBin import test first: assert project/resources rel in runtime, then assert DOM. |
| 4 | Remove debug traversal from production render | Keep debug helpers only on runtime/window/test harness, not render adapters/components. | grep gate: no `debugDumpGraph`/`debugDescribeNode` in production render path. |

Phase 1 implementation note: `src/video-editor/page/createMiniCutEditorSession.ts` now owns browser session creation policy, `src/video-editor/app/main.tsx` owns bootstrap/DEV debug/HMR disposal, and `DktEditorRoot` accepts `bootstrapOptions={null}` when a page session already bootstrapped the runtime.

## Migration Order For One-Shot Rewrite

1. Add missing model attrs/comps/rels first: active project, selected clip/entity, project counts/version, trackEnd, clip timeline bounds, color grade rel/flag, track position, selected clip summary.
2. Add generic app-level helpers only if they are thin aliases around `One`/`useOne` and still call `useShape`. Prefer no MiniCut-specific helper if JSX stays readable.
3. Rewrite `ProjectDropdown`, `TimelineView`, `TrackRow`, `ClipItem`, `Inspector*`, `Toolbar`, `VideoEditorApp`, and `PreviewPanel` to generic DKT reads.
4. Replace component actions with local `useActions()` and model action forwarding. Keep export/import file side effects as explicit effects or clearly isolated bridges, not render helpers.
5. Delete `EditorRenderRuntime`, both render adapters, `useActiveProjectScope`, `useSelectedEntityScope`, and legacy render-runtime tests.
6. Shrink `miniCutEditorRootShape` only after component-level shape demand is proven, so streaming recovery can still be tested incrementally.
7. Revive tests one by one: DKT model comps, page sync shape demand, MediaBin import, ProjectDropdown, Timeline interactions, Inspector tabs, Preview/export.

## Acceptance Checklist

- Every production component reads attrs through generic `useAttrs`, and every rel through `One`, `Many`, `Path`, `useOne`, or `useMany`.
- No production component imports `useEditorAttrs`, `useEditorOne`, `useEditorMany`, `useEditorComp`, `useEditorActions`, `EditorScopeProvider`, `ROOT_SCOPE`, or `SESSION_SCOPE` from `src/video-editor/render-sync`.
- No production render component calls `renderRuntime.readAttrs`, `runtime.readAttrs`, `debugDumpGraph`, or source-id graph scans during render.
- All values currently served by `useEditorComp` exist as DKT model attrs/comps/rels.
- Actions that cross scopes are implemented as model action forwarding, not adapter branches.
- Shape demand is observable from component code: removing the broad root shape should not make a component lose updates for attrs it renders.
- `createDktPageEditorRenderRuntime` and `createDktEditorRenderRuntime` are deleted from production wiring after migration.
- Temporary debug logs in DKT receiver/runtime are removed before final validation.
