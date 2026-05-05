# DKT render tree postmortem, 2026-05-05

## Context

The migration goal was to move MiniCut rendering to a Weather-style DKT render tree: top-down traversal from the streamed session root, local attrs read only inside the current replica scope, and no production fallback through legacy render-sync graph reads.

The migration succeeded, but several issues appeared because old selector habits were mixed with the new replica tree.

## Problems encountered

### Root escape reads

An early implementation introduced a `useRootAttrs` hook so nested components could read session/root attrs directly. This violated the target tree rule: nested components should receive traversal state through model attrs/rels or normal React props from their owner scope. The hook was removed.

Guardrail: if a nested component needs a value for rendering or traversal, derive it in DKT session/model state first, then read it through the scoped replica.

### Combined traversal and attrs selector

`useManyWithAttrs` mixed two responsibilities: subscribing to a relation list and reading attrs from every child in the parent component. It made UI code convenient, but it bypassed the Weather pattern where `Many`/`useMany` only iterate rel scopes and each concrete child component owns its own `useAttrs` subscription.

This was replaced with `useMany` plus scoped child components. That keeps rel subscriptions narrow and makes attr ownership obvious in the render tree.

Guardrail: use relation hooks/components for traversal only. Read child attrs inside the child scope.

### React 19 external-store snapshot identity

React 19 is strict about `useSyncExternalStore`: `getSnapshot` must return the same object or array when underlying data did not change. The durable solution is the Weather-style receiver/runtime cache, not ad hoc object comparisons in every hook.

`ReactSyncReceiver.readAttrs` and `readManyScopes` now define the stability boundary. `useAttrs`, `useMany`, `One`, and `Many` should stay thin and trust the runtime cache.

Guardrail: do not clone attr objects or rel arrays inside hooks. If snapshots become unstable, fix the receiver/runtime cache.

### Direct DKT proxy writes racing model commands

Text edits initially wrote directly to the DKT text proxy and also mirrored through model commands. That created a second authority path and made preview state vulnerable to stale ordering.

Text updates now go through model commands; the DKT proxy and preview attrs are updated from the registry-derived sync path.

Guardrail: user edits should have one authoritative mutation path. DKT proxy writes are only acceptable for intentional scoped action dispatches that do not race the registry authority.

### Text clips normalized to image preview kind

The preview model normalized unknown resource kinds to `image`, and `text` was not allowed in that normalization. Text clips therefore rendered as fallback image-like clips and displayed `TextText` instead of the edited text content.

The derived preview state now preserves `mediaKind: 'text'` as `resourceKind: 'text'`.

Guardrail: derived render attrs must preserve semantic media kinds used by renderer branches.

### Tests reading DKT runtime without React bootstrap

Some legacy render-sync tests created a harness and read the page runtime directly, but did not mount the React DKT root. In production, React calls `pageRuntime.bootstrap()` and mounts shapes. Without that, attrs and rels requested by UI components were not materialized.

The tests now bootstrap the page runtime and mount a minimal shape before reading scoped attrs/rels.

Guardrail: tests that read real `PageSyncRuntime` must bootstrap it and declare the same shape requirements that UI components declare.

## Current stable pattern

Use this shape for production rendering:

1. Root/session component reads only session attrs needed at that level.
2. Traverse with `One`, `Many`, `Path`, or `useMany`.
3. Inside each concrete scoped component, call `useAttrs` for that model's attrs.
4. Keep `ReactSyncReceiver` responsible for stable external-store snapshots.
5. Avoid graph-wide subscriptions, debug graph traversal, and root escape hooks in production render code.

## Validation

After this slice:

- `npm run test:video-editor -- src/video-editor/tests/video-editor.happy-path.test.tsx` passed 18/18.
- `npm run test:video-editor -- src/video-editor/render-sync/createDktEditorRenderRuntime.test.ts` passed 4/4.
- `npm run test:video-editor` passed 308/308.

The follow-up refactor in this document adds dedicated unit coverage for receiver snapshot stability and `Many` + scoped `useAttrs` rendering.