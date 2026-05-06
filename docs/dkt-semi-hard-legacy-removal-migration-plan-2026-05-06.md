# DKT semi-hard plan: full legacy removal and registry compatibility API migration

Date: 2026-05-06

## 1. Objective

Deliver full migration of running app architecture to DKT-only contour:

- only DKT state, DKT DI, DKT actions, DKT tasks, replica attrs/rels in render
- no fallback paths
- no ProjectRegistry as runtime source of truth
- no legacy command dispatch in running app path
- tests migrated to DKT contracts instead of legacy compatibility contracts

This is semi-hard migration:

- phase-by-phase execution is allowed
- inside each phase, cut is hard (no dual-source behavior)
- temporary bridge code is allowed only if explicitly named as removal target in next phase

## 2. Non-negotiable rules

1. Render reads only scope attrs/rels and comp attrs/rels from DKT runtime.
2. UI/business mutations are DKT actions. Runtime side effects are DKT tasks/effects with state return via DKT actions.
3. No running-app business decisions from registry/selectors/command envelopes.
4. No debug graph traversal in production behavior.
5. No hidden compatibility fallback. Missing attrs/rels must fail explicitly and be fixed in DKT models/effects.

## 3. Current architecture review: previewFrame and previewStructure

### 3.1 What exists now

Current read path:

- Preview panel reads full session attrs previewFrame and previewStructure in src/video-editor/components/PreviewPanel.tsx.
- Session root stores these as input attrs in src/video-editor/models/SessionRoot.ts.
- Values are built by computed layer in src/video-editor/dkt/state/derivedTimeline.ts.

### 3.2 Why it was introduced

- Quick way to provide fully prepared preview snapshot to UI.
- Avoid duplicate timeline traversal in many components.
- Keep heavy derivation in one place.

### 3.3 What is wrong with this shape now

- Large monolithic attrs on session root create wide invalidation scope.
- Any cursor/timeline update can trigger broad object-level updates.
- Structure does not express tree semantics via rels (project -> tracks -> clips -> sources).
- UI becomes coupled to one large payload contract instead of scoped model contracts.

### 3.4 Target review decision

Move preview from monolithic session attrs to composable DKT derived model surface:

1. Keep only minimal session-level preview cursor/playback control attrs.
2. Build derived rel/comp graph for preview units:
   - derived preview clip refs (ordered)
   - derived active visual/audio clip sets for current cursor
   - derived clip render inputs per clip scope
3. UI reads small scoped pieces via useAttrs/useOne/useMany rather than one giant structure.
4. Keep pure math helpers, but feed from DKT scoped data, not registry compatibility structures.

### 3.5 Candidate DKT decomposition

- SessionRoot comp attrs:
  - previewCursorState
  - previewActiveClipIds
- Track/Clip level comp attrs:
  - clipInterval
  - clipRenderableState
  - clipAudioState
- Project/Timeline derived rels:
  - timelineClipOrder
  - activeVisualClips
  - activeAudioClips

Note: naming is provisional; exact schema should be defined before implementation (Phase 2).

## 4. Mandatory migration of registry compatibility API

Registry compatibility API is currently still present in runtime/app bridge and must be removed from running app path.

Primary removal targets:

- src/video-editor/app/createVideoEditorHarness.ts
  - renderRegistry and legacy runtime fallback wiring
  - stores.getRegistry usage in runtime decision paths
- src/video-editor/render-sync/createDktEditorRenderRuntime.ts
  - deprecated compatibility render runtime
- src/video-editor/render-sync/DktRegistryRenderStore.ts
  - deprecated registry sync store
- src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts
  - dispatchCommand
  - getRegistrySnapshot / replaceRegistrySnapshot as runtime truth APIs
  - materializeRegistryHierarchy and source-id seeded registry bridge
- src/video-editor/dkt/runtime/previewModelFromRegistry.ts
  - registry-based preview derivation

Compatibility can remain only in explicitly marked test harness adapters during transition window and must be deleted by final phase.

## 5. Defensive code review and simplification track

Required review scope: defensive checks like typeof ... === 'string' and similar broad runtime guards.

Example current hotspot:

- src/video-editor/models/Track/actions.ts in normalizeClipCreationAttrs and normalizeTextCreationAttrs.

### 5.1 Decision framework

For each defensive check, classify into one of 3 categories:

1. External boundary guard (keep):
   - data from transport, worker messages, browser APIs, user files
2. Internal DKT typed action contract (simplify/remove):
   - action payload already typed and validated at dispatch boundary
3. Legacy compatibility uncertainty (delete by migration):
   - check exists only because mixed old/new path is still allowed

### 5.2 Simplification strategy

1. Push validation to boundary adapters (task/effect inputs, transport receiver).
2. Keep model actions operating on strict typed payloads.
3. Replace repeated per-field typeof checks with shared normalizers or typed constructors where boundary validation already happened.
4. Remove nullable fallback defaults that hide malformed internal payloads.

## 6. Phase plan (semi-hard)

## Phase 0. Baseline, freeze, and contract declaration

Goal: lock migration contracts and prevent new legacy growth.

Steps:

1. Add architecture guard doc references to active planning docs.
2. Mark forbidden patterns in review checklist:
   - new env.stores.getRegistry decisions
   - new authority.dispatch command paths in app UI runtime
   - new fallback to deprecated render runtime
3. Add temporary lint/grep CI check for forbidden imports/usages in running app paths.

Files:

- docs/dkt-semi-hard-legacy-removal-migration-plan-2026-05-06.md
- optional CI/config files if grep guard is automated

Tests:

- no functional changes
- add/adjust static architecture checks if implemented

Exit criteria:

- forbidden legacy patterns are blocked for new changes

## Phase 1. Remove command path from running app actions

Goal: app runtime dispatches only DKT actions/tasks.

Steps:

1. Replace text clip creation command flow with DKT action flow.
   - remove createTextAddCommand usage in app actions
2. Remove runtime command debug helper behavior from app DEV bridge where it affects architecture assumptions.
3. Ensure all user-facing edit/import/create actions go through DKT ports.

Files:

- src/video-editor/app/mediaImportActions.ts
- src/video-editor/app/createDktActionRuntime.ts
- src/video-editor/app/VideoEditorHarnessApp.tsx
- optionally src/video-editor/domain/actionCommandBuilders.ts (only if no running path usage remains)

Tests to update/add:

- src/video-editor/app/createVideoEditorHarness.test.ts
- src/video-editor/tests/video-editor.happy-path.test.tsx
- targeted action runtime tests for addTextClip

Exit criteria:

- no running app path uses createTextAddCommand or authority.dispatch for editor actions

## Phase 2. Registry compatibility API cut from render/runtime

Goal: remove registry compatibility runtime as active path.

Steps:

1. Stop creating/using legacy render runtime in harness.
2. Remove registry render store usage for runtime behavior.
3. Keep only DKT page runtime adapter for render reads and dispatch.
4. Delete deprecated compatibility files when no imports remain.

Files:

- src/video-editor/app/createVideoEditorHarness.ts
- src/video-editor/render-sync/createDktPageEditorRenderRuntime.ts
- src/video-editor/render-sync/createDktEditorRenderRuntime.ts (delete)
- src/video-editor/render-sync/DktRegistryRenderStore.ts (delete)

Tests to update/add:

- render runtime tests currently bound to deprecated compatibility layer
- page sync receiver tests if compatibility receiver changes
- component integration tests that rely on registry snapshots

Exit criteria:

- running render path has no registry compatibility runtime/store
- all render reads are from DKT page runtime scopes

## Phase 3. Preview decomposition into comp attrs / derived rels

Goal: replace giant preview session attrs with scoped derived contracts.

Steps:

1. Define final DKT preview schema (attrs/rels/comp attrs).
2. Implement derived rel/comp computation in DKT state/model layer.
3. Migrate PreviewPanel and color scopes components to scoped reads.
4. Remove old session attrs previewFrame/previewStructure from active UI contracts.

Files:

- src/video-editor/dkt/state/derivedTimeline.ts
- src/video-editor/models/SessionRoot.ts
- src/video-editor/models/SessionRoot/actions.ts
- src/video-editor/components/PreviewPanel.tsx
- src/video-editor/components/ColorScopesPanel.tsx
- src/video-editor/read-model/previewReadModel.ts (reduce to pure helpers or delete facade)

Tests to update/add:

- preview model tests
- preview panel component tests
- color scopes tests
- performance regression checks for cursor scrub/playback updates

Exit criteria:

- PreviewPanel does not consume monolithic previewFrame/previewStructure attrs
- preview data is consumed via scoped derived attrs/rels

## Phase 4. Runtime DKT API cleanup and registry bridge deletion

Goal: remove registry snapshot/command compatibility from DKT runtime public surface.

Steps:

1. Remove dispatchCommand API and command-message handling from runtime transport path.
2. Remove getRegistrySnapshot/replaceRegistrySnapshot from running app integration surface.
3. Delete materializeRegistryHierarchy and source-id based seeded model syncing that exists only for registry parity.
4. Keep only explicit DKT action/task interfaces.

Files:

- src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts
- src/video-editor/dkt/shared/messageTypes.ts
- src/video-editor/worker/memoryWorker.ts
- src/video-editor/worker/sharedWorker.ts
- related adapters using snapshot replacement

Tests to update/add:

- src/video-editor/dkt/runtime/createMiniCutDktRuntime.test.ts
- src/video-editor/worker/memoryWorker.test.ts
- src/video-editor/worker/authorityRuntimeParity.test.ts
- src/video-editor/worker/authorityClient.contract.ts

Exit criteria:

- runtime public API contains only DKT-native actions/tasks/sync contracts
- no command/snapshot compatibility API in running path

## Phase 5. Defensive checks simplification pass

Goal: remove over-defensive internal guards and simplify model logic after contracts are strict.

Steps:

1. Audit normalize* functions and reducers for repeated primitive guards.
2. Keep guards only at external boundaries.
3. Refactor model actions to typed payload assumptions.
4. Replace broad defaulting that masks internal contract violations with explicit null return or error semantics where appropriate.

Priority files:

- src/video-editor/models/Track/actions.ts
- src/video-editor/models/Clip/actions.ts
- src/video-editor/models/Text/actions.ts
- src/video-editor/models/Effect/actions.ts
- src/video-editor/models/SessionRoot/actions.ts

Tests to update/add:

- model action unit tests for malformed payload at boundary
- internal contract tests for strict payload behavior

Exit criteria:

- guard complexity is reduced and intentional
- internal DKT action payload path is strongly typed and not silently normalized from unknown

## Phase 6. Final deletion and contract hardening

Goal: complete removal migration and lock DKT-only architecture.

Steps:

1. Delete legacy command-centric domain paths not used by running app.
2. Delete remaining registry compatibility helpers and dead adapters.
3. Clean imports and update documentation to single architecture.
4. Run full test matrix and build validation.

Files likely affected:

- src/video-editor/domain/actionCommandBuilders.ts and related command helper modules (if no required non-running contracts remain)
- src/video-editor/domain/applyCommand.ts and command handlers (or isolate as explicit non-running compatibility package if still needed for external contract tests)
- stale re-export barrels and compatibility-only shims

Tests to update/add:

- migrate tests from command-envelope expectations to DKT action/effect expectations
- keep only explicit compatibility tests if compatibility package remains intentionally

Exit criteria:

- running app path contains no legacy command and no registry source-of-truth code
- docs and tests reflect DKT-only runtime architecture

## 7. Test execution matrix per phase

Minimum per phase:

1. targeted unit tests for changed modules
2. targeted integration tests for touched runtime flows
3. npm run video-editor:build
4. git diff --check

Mandatory final matrix:

1. all video-editor unit/integration tests
2. worker and authority contract suites updated for DKT-native APIs
3. Playwright happy-path and media import/export critical path

## 8. Suggested commit sequence

1. docs: add semi-hard full removal migration plan
2. refactor: replace text add command path with DKT action flow
3. refactor: remove registry compatibility render runtime/store from harness
4. refactor: decompose preview into scoped derived rels/comps
5. refactor: remove runtime command/snapshot compatibility APIs
6. refactor: simplify defensive normalization in model actions
7. chore: delete dead legacy modules and migrate remaining tests

## 9. Risks and controls

Main risks:

- hidden dependency on registry snapshots in tests and worker paths
- preview performance regressions after decomposition
- brittle contracts during defensive-check simplification

Controls:

- phase-gated rollouts with hard exit criteria
- explicit contract tests for DKT action/task payloads
- perf spot checks on cursor scrub, playback, and timeline interactions

## 10. Definition of done

Migration is done only when all are true:

1. running app architecture is DKT-only
2. no fallback registry/command paths in runtime behavior
3. preview/selection read path is scoped attrs/rels/derived comps
4. defensive guards are intentional and boundary-only
5. tests and docs describe only the target architecture
