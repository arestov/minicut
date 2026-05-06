# DKT hard rewrite anti-patterns

Date: 2026-05-06

This document is a review checklist for the hard MiniCut rewrite. It describes how code must not be written during the DKT migration.

The current target is not a compatibility bridge. The target is a total rewrite of the running editor contour so DKT is the only state, action, DI, task, and render source of truth.

## Absolute rule

No fallback to the old architecture is allowed, even temporarily.

If a value is missing in the DKT render tree, fix the DKT model attrs, comp attrs, rels, comp rels, actions, or effects. Do not patch the missing value by reading the old registry, Legend stores, debug replica, or worker snapshot.

## Do not write render code like this

Do not read app state from `projects$`, `session$`, `ProjectRegistry`, command snapshots, or selector/read-model helpers in React render code.

Do not create helper hooks that escape the current DKT scope, such as root/session readers used from arbitrary child components.

Do not traverse a replica/debug graph to find children, parents, source ids, selected items, resources, effects, or text models.

Do not join root-routed rels from render to compensate for missing owner rels. If `Project.resources`, `Track.clips`, or `Clip.effects` is empty, the model action is incomplete.

Do not let components read child attrs in a parent loop. Relation traversal belongs to `One`, `Many`, `Path`, or a tiny rel hook. Child attrs belong inside the scoped child component.

Do not put giant registry-shaped objects into session attrs so render can keep old assumptions. Large attrs are allowed only when they are a deliberate DKT-owned render plan, not a hidden registry projection.

Do not make `createDktPageEditorRenderRuntime` fall back to `createDktEditorRenderRuntime`, `DktRegistryRenderStore`, or any legacy runtime when a DKT page runtime exists.

## Do not write actions like this

Do not implement workflows as `dispatch -> await -> read state -> dispatch more`. The workflow must be a DKT action array, inline saga, model `handleInit`, or DKT effect/task result.

Do not dispatch a DKT action and a legacy command envelope for the same user event.

Do not decide business logic from `env.stores.getRegistry()`, selectors, `projects$.get()`, or `session$.get()`.

Do not use app-layer helpers to choose tracks, clips, effect order, selected entities, preview rows, or export resources. Those choices belong to DKT models.

Do not create a root model without also writing the semantic owner rel in the same DKT action when the owner rel is the render traversal path.

Do not use source-id scans to find dispatch scopes. UI dispatch should already be scoped by traversal: a button inside a `Clip` scope dispatches to that `Clip` scope.

Do not use `$noop` in named-result action arrays unless the returned shape is valid for the action target. Guard invalid payloads with `when` or return the named result object expected by DKT.

## Do not write boundary code like this

Do not let worker, P2P, media import, export, object URL, or browser file handling become a second state graph.

Do not patch export by cloning a registry snapshot and overlaying transfer-manager state.

Do not mirror session selection, cursor, playback, zoom, or active project into a non-DKT store and then use that mirror for behavior.

Do not keep `GET_SNAPSHOT`, `REPLACE_SNAPSHOT`, `DISPATCH_COMMAND`, `PATCHES`, or command-envelope protocols in the running DKT editor path.

Do not leave old tests asserting implementation details of registry, Legend stores, command envelopes, or snapshot patches. If a test is kept broken during phase 1, its comment must describe the real product behavior it protects, not the old implementation.

## Review smell list

Reject a change if it adds or keeps any of these in the running editor path:

- `ProjectRegistry` as a state source.
- `projects$` or `session$` as a render/business source.
- `getSnapshot`, `replaceSnapshot`, `applyPatchEnvelope`, or command-patch sync.
- `dispatchCommand` or command-envelope action builders for editor state.
- `debugDumpGraph`, `debugDescribeNode`, source-id reverse lookup, or replica scans.
- A `legacyRuntime`, `legacyStore`, `fallbackRuntime`, or compatibility runtime branch.
- A helper whose purpose is to rebuild DKT rels from old state.
- App code that reads state after one dispatch to decide the next dispatch.

## Correct failure mode

During this rewrite, broken tests and visible missing UI are acceptable if they expose missing DKT model contracts.

Silent compatibility is not acceptable. A missing DKT attr or rel must fail loudly enough that the next change adds the attr, comp attr, rel, comp rel, action, or effect at the owning DKT model.