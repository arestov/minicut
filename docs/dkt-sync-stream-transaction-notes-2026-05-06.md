# DKT sync stream, transaction boundaries, and MiniCut render view

Date: 2026-05-06

## What the stream sends

`sync_sender.addSyncStream(start_md, stream, important_rel_paths)` attaches a page stream to a model root. In MiniCut the root is the session root; the app model is reached through `pioneer`.

The initial attach is a stream bootstrap, not a snapshot API:

- `SET_DICT` and `SET_MODEL_SCHEMA` define compact ids for model names, attrs, and rels.
- `TREE_ROOT` sends the root base.
- `toSimpleStructure(...)` walks the requested important rel paths and sends tree base, attrs, and rels.
- `R_UPDATE_TREE_COMPLETE` marks the end of that initial materialization.

After bootstrap, DKT sends small live updates:

- `pushStates` emits attr diffs for mounted shapes.
- `pushNesting` emits rel diffs and may also send child bases when a changed rel points at models the page has not seen yet.
- `handleRelChange` decides whether the changed rel is part of the stream's important paths or shape usage.

This means the page is a stream receiver. It should ask for shapes and traverse received attrs/rels. It should not read runtime debug dumps, `getLinedStructure`, local model state, or a registry replica.

## CallbackFlow and transaction end

Actions run inside `CallbacksFlow` as ordered `FlowStep`s. A step pushed while another step is current inherits that transaction id and is ordered as a child of the current motivator.

For normal action passes, `execAction` schedules two sequence steps:

1. run the action function and store the pass result;
2. save the result into attrs/rels.

Inline sagas expand the same idea over multiple pairs of run/save steps. A child action called with `inline_subwalker: true` stays inside the same inline saga runtime and transaction.

`CallbacksFlow.iterateCallbacksFlow()` calls `onBeforeTransactionEnd` before the final boundary and `onFinalTransactionStep` when the transaction id changes or the queue is empty. DKT sync is committed at that boundary: `sync_sender.commitTransaction()` drains each stream's `pushed_by_state_queue` only after the transaction's model writes are complete.

## Owner rel delivery check

Root-routed constructors such as `<< clip << #` and `<< resource << #` create models in root/app rels. Owner rels such as `Project.resources`, `Track.clips`, or `Clip.effects` are separate writes. Those owner rel writes still arrive as ordinary DKT rel changes.

This is not a DKT React Sync bug. A unit test in `src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime.test.ts` proves that `subscribeMany` is notified when an initially empty rel receives a later update. `One`, `Many`, and `Path` can rely on direct rel updates.

The real MiniCut bug was model-side: some actions created a root-routed model but did not also write the owning rel. In that case the page correctly received the root model, but there was no owner rel update to observe.

- `Project.importResource` must create the resource and update `Project.resources` in the same inline saga step.
- `Track.addClip`, `Track.addTextClip`, and `Track.splitClipAt` must create clips and update `Track.clips` through held refs.
- `Clip.addEffect` must create effects and update `Clip.effects` through held refs.

## MiniCut solution

The render runtime keeps strict top-down traversal over the page stream and reads direct owner rels: `project.tracks`, `project.resources`, `track.clips`, `clip.resource`, `clip.text`, and `clip.effects`.

No render path should join against root-routed rels to compensate for missing owner rel writes. If a child is visible only through a root-routed constructor rel, the model action is incomplete.

## Migration rule

Do not add temporary compatibility code that builds a legacy `ProjectRegistry` shape for the running editor path.

If a feature still needs registry-shaped data, that feature is not migrated yet. Phase 1 of the hard rewrite should delete the legacy runtime path and leave the affected tests or features visibly incomplete until the pure DKT model attrs, comp attrs, rels, comp rels, actions, tasks, and effects are implemented.