# Phase 3 Export Integration Plan: InspectorExportTabPanel

## Overview

This document details the Phase 3 export pipeline integration, specifically how `InspectorExportTabPanel.tsx` converts from callback-based progress tracking to model state-based progress tracking.

**Key Decision**: Replace `onProgress` callback with `exportProgress` state field on Clip/SessionRoot models. This gives:
- Cleaner serialization (no callbacks in payloads)
- P2P sync support (progress syncs across clients)
- Single source of truth in model state
- UI reads progress via `useAttrs()` like any other state

## Current State (Before Phase 3)

### InspectorExportTabPanel.tsx

```tsx
// Current (line 9-30)
const [exportStatus, setExportStatus] = useState<ExportStatus>({ state: 'idle' })
// ...
onClick={() => {
  setExportStatus({ state: 'rendering', progress: { stage: 'queued', progress: 0 } })
  actions.queueClipExportById(clipId, (progress) => {
    setExportStatus((current) => 
      current.state === 'rendering' ? { state: 'rendering', progress } : current
    )
  })
  .then((result) => {
    setExportStatus(result ? { state: 'ready', result } : { state: 'error', ... })
  })
  .catch((error) => {
    setExportStatus({ state: 'error', message: error.message })
  })
}}
```

**Problem**: 
- `onProgress` callback not serializable in DKT action payload
- Progress state in component instead of in model
- Callback-based update loop when model state change is more idiomatic

### editorHarnessAdapter.ts queueClipExportById

```ts
queueClipExportById(clipId: string, onProgress: (progress: ExportProgress) => void) {
  // finds clip scope, reads attrs, builds export plan manually, returns promise
  // calls onProgress during rendering
}
```

**Problem**: Fallback export logic (manual traversal + attrs read), closure callback coupling.

## Target State (After Phase 3)

### Model Structure: Clip & SessionRoot

Add `exportProgress` field to both **Clip** and **SessionRoot** (for different export targets):

```ts
// src/video-editor/models/Clip.ts attrs
interface ClipAttrs {
  // ... existing attrs
  exportProgress?: {
    stage: 'idle' | 'queued' | 'rendering' | 'done' | 'error'
    progress: number  // 0-100
    message?: string  // error message
  }
}

// src/video-editor/models/SessionRoot.ts attrs
interface SessionRootAttrs {
  // ... existing attrs
  exportProgress?: {
    stage: 'idle' | 'queued' | 'rendering' | 'done' | 'error'
    progress: number
    message?: string
  }
}
```

### Model Actions: Export Pipeline

#### On Clip model: `requestClipExport`

```ts
// src/video-editor/models/Clip.ts actions
{
  type: 'requestClipExport',
  deps: `< @all:clipRenderData`, // own render data
  steps: [
    // Step 1: Build export plan from clipRenderData
    {
      target: 'this',
      action: 'setExportProgress',
      input: { stage: 'queued', progress: 0 }
    },
    // Step 2: Dispatch render task
    {
      target: '$fx_renderExport',
      input: '$output.exportPlan'  // built from deps
    }
  ]
}
```

#### On SessionRoot: `requestProjectExport`, `requestSelectedClipExport`

```ts
// src/video-editor/models/SessionRoot/actions.ts
{
  type: 'requestProjectExport',
  deps: `< @all:clipRenderData < activeProject.tracks.clips`,
  steps: [
    { target: 'this', action: 'setExportProgress', input: { stage: 'queued', progress: 0 } },
    { target: '$fx_renderExport', input: '$output.exportPlan' }
  ]
}

{
  type: 'requestSelectedClipExport',
  deps: `<< selectedClip < clipRenderData`,  // use selected clip scope
  steps: [
    { target: 'this', action: 'setExportProgress', input: { stage: 'queued', progress: 0 } },
    { target: '$fx_renderExport', input: '$output.exportPlan' }
  ]
}
```

#### Helper: `setExportProgress` (on both Clip and SessionRoot)

```ts
{
  type: 'setExportProgress',
  input: { stage: string, progress: number, message?: string },
  impl: (ctx, { stage, progress, message }) => {
    ctx.attrs.exportProgress = { stage, progress, message }
  }
}
```

### Runtime Task Executor: $fx_renderExport

The executor now **updates progress by dispatching** `setExportProgress` action instead of calling callback:

```ts
// Runtime task executor for $fx_renderExport
async function renderExportTask(taskPayload) {
  const { exportPlanJson, targetNodeId, targetScope } = taskPayload
  const plan = JSON.parse(exportPlanJson)
  
  let renderedFrames = 0
  const totalFrames = plan.clips.reduce((sum, clip) => sum + clip.duration, 0)
  
  // Progress tracking: dispatch to model instead of callback
  const updateProgress = (stage, progress, message) => {
    const action = { type: 'setExportProgress', stage, progress, message }
    dispatchToScope(targetScope, targetNodeId, action)
  }
  
  for (const clip of plan.clips) {
    updateProgress('rendering', Math.round(100 * renderedFrames / totalFrames))
    // render clip...
    renderedFrames += clip.duration
  }
  
  updateProgress('done', 100, 'Export complete')
  return { downloadUrl, size, frameCount }
}
```

### UI Component: InspectorExportTabPanel

Convert from local state + callback to reading from model attrs:

```tsx
export const InspectorExportTabPanel = () => {
  // Replace local state with attrs read
  const { sourceClipId, name, exportProgress } = useAttrs([
    'sourceClipId',
    'name',
    'exportProgress'
  ]) as {
    sourceClipId?: string
    name?: string
    exportProgress?: ExportProgress
  }
  
  const clipId = typeof sourceClipId === 'string' ? sourceClipId : null
  const { dispatch } = useActions()
  
  const handleExport = async () => {
    if (!clipId) return
    
    // Dispatch scoped action (no callback)
    dispatch('requestClipExport')
  }
  
  return (
    <div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Export inspector">
      <InspectorSection title="Clip export" icon={Download}>
        {/* ... export params ... */}
        <IconButton
          type="button"
          icon={Download}
          label="Queue clip export"
          variant="default"
          disabled={exportProgress?.state === 'rendering' || !clipId}
          onClick={handleExport}
        >
          {exportProgress?.state === 'rendering'
            ? `Rendering ${formatExportProgress(exportProgress)}`
            : 'Queue clip export'}
        </IconButton>
        
        {/* Progress display - read from attrs */}
        {exportProgress?.state === 'rendering' ? (
          <p className="ve-preview__summary" aria-live="polite">
            Rendering export file for {String(name)}: {formatExportProgress(exportProgress)}
          </p>
        ) : null}
        
        {exportProgress?.state === 'done' ? (
          <p className="ve-preview__summary" role="status">
            Export ready: {exportProgress.message}
            {/* download link logic */}
          </p>
        ) : null}
        
        {exportProgress?.state === 'error' ? (
          <p className="ve-preview__summary" role="status">
            Export failed: {exportProgress.message}
          </p>
        ) : null}
      </InspectorSection>
    </div>
  )
}
```

## Implementation Steps

### Step 1: Model Changes (Clip + SessionRoot)

1. **Clip.ts**: Add `exportProgress` attr type + `setExportProgress` action
2. **SessionRoot/actions.ts**: Add `requestProjectExport`, `requestSelectedClipExport`, `setExportProgress` 
3. **Verify**: `npm run tsc --noEmit`

### Step 2: Runtime Task Executor

1. **runtimeTaskFacade.ts**: Update `$fx_renderExport` executor to call `dispatchToScope` for progress instead of callback
2. **Verify**: Runtime debug shows correct dispatch sequence

### Step 3: UI Component

1. **InspectorExportTabPanel.tsx**: 
   - Remove local `exportStatus` state
   - Replace `useAttrs(['sourceClipId', 'name'])` with `useAttrs(['sourceClipId', 'name', 'exportProgress'])`
   - Replace `actions.queueClipExportById(clipId, onProgress)` with `dispatch('requestClipExport')`
   - Map `exportProgress` field to UI (stage → state, progress → percentage, message → error text)

2. **Toolbar.tsx** (project export):
   - Similar conversion: `dispatch('requestProjectExport')` → read `useAttrs(['exportProgress'])` from SessionRoot

3. **Verify**: Components build and compile

### Step 4: Integration Tests

1. **Browser smoke test**: 
   ```bash
   npm run repl:playwright
   # Click export → progress appears → result shows
   ```

2. **Model state check**:
   ```bash
   npm run repl:run
   # Verify exportProgress field updates via dispatch sequence
   ```

3. **Edge cases**:
   - Fast double-click export (queue policy should replace-last)
   - Export with empty clips (should error)
   - Export during project load

## Technical Details

### Queue Policy for $fx_renderExport

Set `queuePolicy: 'replace-last'` in runtimeTaskFacade to prevent duplicate renders on rapid clicks:

```ts
// runtimeTaskFacade.ts
case '$fx_renderExport':
  return {
    intent: 'call',
    queuePolicy: 'replace-last',  // ← replace pending export if new one queued
    executor: renderExportTask
  }
```

### Progress Field Sync (P2P Optional)

If P2P sync is enabled, progress updates through model state automatically sync to other clients:
- Executor calls `dispatchToScope('setExportProgress', { stage, progress })`
- Action updates model attr
- P2P sync broadcasts change
- Other clients' UI reads updated attr through `useAttrs`

### Error Handling

If export fails (e.g., sourceProjectId empty):

```ts
// In setExportProgress or export action error handler
dispatch('setExportProgress', {
  stage: 'error',
  progress: 0,
  message: 'Select a project before exporting'
})
```

UI component reads `exportProgress.state === 'error'` and displays error message.

## Breaking Changes

1. `actions.queueClipExportById(clipId, onProgress)` → **removed**
   - Replaced by scoped `dispatch('requestClipExport')`
   
2. `exportProgress` field now required in Clip/SessionRoot attrs
   - Impacts serialization format (minor)
   - Model tests need to account for this field

## Rollback Plan

If Phase 3 export pipeline fails:
1. Revert model action changes (keep models without export actions)
2. Revert runtime executor changes
3. Revert UI components (restore local state + callback)
4. Fallback to Phase 2 state (import works, export waits for next attempt)

## Success Criteria

- ✅ Export progress appears in UI without callback
- ✅ Progress syncs across P2P clients (if applicable)
- ✅ Rapid double-click doesn't create duplicate renders
- ✅ Error state displays correctly on invalid project/clip
- ✅ No TypeScript errors after phase completion
- ✅ Smoke tests pass: `npm run repl:playwright`
- ✅ Model state shows correct `exportProgress` field through all stages
