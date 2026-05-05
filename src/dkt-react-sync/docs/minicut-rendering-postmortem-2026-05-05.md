# MiniCut DKT Rendering Postmortem

Date: 2026-05-05

## Summary

The latest DKT rendering attempt fixed several real streaming races, but it did so by adding too much intelligence to the render adapter. The most visible symptom was `ReactSyncReceiver.allSubs`: a graph-wide subscription added so UI selectors would wake up when related nodes arrived in separate sync messages.

That made tests move forward, but it was the wrong architectural direction. DKT traversal, aggregation, parent lookup, and action routing should be expressed by model rels, comp attrs/rels, and action forwarding. Rendering should stay top-down from the current scope and should not search the whole replica graph.

## What Happened

The page replica streams gradually. A node can arrive first, then attrs, then rels. The adapter tried to bridge this by:

- scanning `debugDumpGraph()` to find models by `source*Id`;
- deriving `activeProject` and `selectedEntity` in TypeScript;
- subscribing to every graph update through `allSubs`;
- reading legacy `readComp()` for state that should live in DKT model comps;
- mirroring session writes through both Legend session state and DKT page runtime.

This helped expose real missing DKT materialization paths, but it mixed model traversal concerns into rendering.

## Why `allSubs` Was Wrong

`allSubs` was a coarse wake-up mechanism. It let any sync chunk re-render any derived UI selector. That hides dependency mistakes instead of modeling them.

Correct dependency tracking should be one of:

- attr subscription on the current scope;
- one/many rel subscription on the current scope;
- model comp attr/rel whose deps declare the traversal path;
- model action forwarding through a declared rel path.

If a component needs `project.totalDuration`, it reads a project comp. If a clip needs project-level state, the clip model should expose or receive it through declared rel/dependency paths. If a local action needs to update a parent or child, the model action forwards through `to` and `sub_flow`, not through React/harness code.

## Bad Patterns Found

- Render adapter as selector engine: `createDktPageEditorRenderRuntime` computes `activeProject`, `selectedEntity`, source-id lookups, and comp fallbacks.
- Debug graph as production data source: `debugDumpGraph()`/`debugDescribeNode()` are used to navigate the app tree.
- Legacy comp fallback: `readComp()` delegates to the registry runtime.
- Session double-write: session setters write Legend state and DKT page state.
- Test waits masking missing model deps: some happy-path changes wait for streamed UI instead of removing the model-level race.

## Fixes Already Made

- Removed `allSubs`/`subscribeAll` from the generic receiver.
- Removed graph-wide wakeups from the current compatibility `EditorRenderRuntime` adapter.
- Added a receiver-level dictionary flush so concrete string-name subscriptions wake when numeric streamed keys become resolvable after `SET_DICT`.
- Kept DKT-native materialization fixes for owner rels and effect attrs, because these repair actual model tree state.

## Required Next Direction

The adapter should be treated as temporary compatibility. It must shrink, not grow.

Priority order:

1. Add MiniCut model comps/rels for data currently derived by render adapter.
2. Add local model actions that forward through rel paths.
3. Move UI rendering to `RootScope`, `Path`, `One`, `Many`, `useAttrs`, and `useActions` directly.
4. Remove source-id graph scans from render code.
5. Remove legacy registry `readComp()` from DKT-backed render path.
6. Keep `src/dkt-react-sync` generic: no app traversal policy, no app source-id lookup, no graph-wide wake API.

## Acceptance Rule

A render fix is acceptable only if the component can name its data dependency as current-scope attrs/rels, a DKT comp, or a declared parent/child rel path. If the fix needs a graph search or global subscribe, it belongs in the migration postmortem, not in production architecture.
