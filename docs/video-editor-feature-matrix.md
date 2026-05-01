# Video Editor Feature Matrix

## Planned Functions

| Function | Planned behavior | Current implementation target | Playwright scenario |
| --- | --- | --- | --- |
| Project creation and switching | Create projects from a compact top-left menu and keep project data isolated. | `ProjectDropdown`, `PROJECT_CREATE`, active project session state. | Create two projects, switch through menu, verify isolated media/timeline state. |
| Media import | Import video, image, and audio through the real interface. | `MediaBin` file input, `RESOURCE_IMPORT`, blob URLs, fixture media. | Upload video/image/audio fixtures, verify all resources appear. |
| Resource thumbnails | Show a small visual preview for each resource in the media bin. | Thumbnail slot in each resource row for image/video/audio/sample kinds. | Upload fixtures, verify image/video/audio thumbnails are visible and typed. |
| Add resources to timeline | Add resources to compatible tracks; the first imported resource is inserted automatically when the timeline is empty. | `TIMELINE_ADD_CLIP`, video/image to V1, audio to A1, empty-timeline auto-add in the harness. | Add imported resources and verify clips are present on timeline tracks. |
| Shared current step | Timeline has one global vertical current step/playhead across all tracks. | Single overlay playhead in `TimelineView`, no per-track cursor duplication. | Move cursor and verify exactly one timeline playhead spans ruler and tracks. |
| Timeline overflow | Tracks remain visible and reachable when timeline content grows. | Scrollable timeline body and track list. | Populate many clips/tracks equivalent content and verify timeline body scrolls without clipping. |
| Clip selection | Select clips from timeline and open inspector state. | `ClipItem`, `selectedEntityId`, `Inspector`. | Click a clip and verify inspector controls are enabled. |
| Clip trim | Trim start/end while preserving valid duration and in-point. | Inspector trim buttons, `CLIP_UPDATE_ATTRS`. | Trim start/end and verify start/duration/in values update. |
| Clip move | Move clips on timeline with pointer drag or nudge. | Pointer drag, nudge action, `TIMELINE_MOVE_CLIP`. | Drag or nudge a clip and verify start time changes. |
| Clip split | Split selected clip into two timeline clips. | Inspector split button, `TIMELINE_SPLIT_CLIP`. | Split selected clip and verify two clips are rendered. |
| Clip delete | Delete selected clip and its effects. | Inspector delete button, `TIMELINE_DELETE_CLIP`. | Delete selected clip and verify empty inspector state. |
| Opacity editing | Change opacity and reflect it in preview. | Inspector opacity slider, renderer layer opacity. | Change opacity and verify preview layer CSS opacity. |
| Transform editing | Change position, scale, and rotation. | Inspector transform inputs, renderer transform style. | Edit X/Y/scale/rotate and verify preview transform changes. |
| Color labeling | Change clip label/accent color. | Inspector color picker and swatches. | Set a preset color and verify clip/inspector color state. |
| Effects | Add blur, sharpen, and tint effects. | Inspector effect buttons, filter mapping in preview. | Add effects and verify count plus renderer filter. |
| Audio controls | Expose audio edit controls for selected clips. | Inspector Audio tab placeholders for gain/pan. | Open Audio tab and verify controls are reachable. |
| Export controls | Export selected clips through a renderer abstraction. | Inspector Export tab queues `ExportRenderer` and produces a downloadable render manifest. | Open Export tab, queue export, and verify ready status. |
| Playback cursor | Play/pause advances preview cursor. | Preview play button, session playback tick hook. | Toggle playback and verify current time changes. |
| OffscreenCanvas preview | Preview uses OffscreenCanvas worker rendering with fallback. | Canvas worker draws frame backdrop and clip labels behind media layers. | Verify renderer canvas is nonblank and reports offscreen/fallback mode. |

## Existing Buttons And Component Scaffolds

| Component | Control or scaffold | Connected action/state | Notes |
| --- | --- | --- | --- |
| `Toolbar` | Import sample | `actions.importSampleResource()` | Creates sample resource without file picker. |
| `ProjectDropdown` | New project | `actions.createProject()` | Compact top-left project creation. |
| `ProjectDropdown` | Project list items | `actions.setActiveProject(projectId)` | Switches active project. |
| `MediaBin` | Import file input | `actions.importFiles(files)` | Real media import. |
| `MediaBin` | Add to timeline | `actions.addResourceToTimeline(resourceId)` | Routes by resource kind. |
| `TimelineView` | Cursor slider | `actions.setCursor(value)` | Source of preview current time. |
| `TimelineView` | Zoom out/in | `actions.zoomTimeline(delta)` | Changes px/s. |
| `ClipItem` | Clip button | `actions.selectEntity(clipId)` | Selects clip. |
| `ClipItem` | Pointer drag | `actions.moveClipById(clipId, delta)` | Moves clip in timeline. |
| `PreviewPanel` | Play/Pause | `actions.togglePlayback()` | Toggles playback state. |
| `Inspector` | Clip name | `actions.renameSelectedClip(name)` | Updates selected clip attrs. |
| `Inspector` | Opacity slider | `actions.updateSelectedClipOpacity(value)` | Updates preview opacity. |
| `Inspector` | Trim buttons | `actions.trimSelectedClip(edge, delta)` | Updates start/duration/in. |
| `Inspector` | Transform inputs | `actions.updateSelectedClipTransform(partial)` | Updates preview transform. |
| `Inspector` | Effect buttons | `actions.addEffectToSelectedClip(kind)` | Creates effect entities. |
| `Inspector` | Split clip | `actions.splitSelectedClip()` | Creates right-side clip. |
| `Inspector` | Nudge +0.5s | `actions.nudgeSelectedClip(0.5)` | Moves selected clip. |
| `Inspector` | Delete clip | `actions.deleteSelectedClip()` | Removes clip. |
| `Inspector` | Color picker/swatches | `actions.colorSelectedClip(color)` | Label/accent color. |
| `Inspector` | Audio tab controls | Read-only gain/pan placeholders | UI scaffold only. |
| `Inspector` | Export tab queue | `actions.queueSelectedClipExport()` | Produces a render manifest with evaluated frame operations. |
