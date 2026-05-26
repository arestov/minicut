# Postmortem: External Orchestration Anti-Pattern in DKT Runtime

**Date:** 2026-05-07  
**Branch:** dkt-render  
**Commit corrected:** 3069e13 ("remove runtime ownership orchestration, keep DKT-only dispatch flow")

---

## Summary

During the ownership-relations implementation sprint, a `syncOwnershipRels` function was added to `createMiniCutDktRuntime.ts`. It iterated over tracks and clips, reading intermediate model state, then dispatching ownership-setter actions one by one from the runtime layer. This is the **external / caller-driven orchestration** anti-pattern — categorically forbidden in this codebase.

The code was identified and removed entirely. This document explains **why** it is forbidden and what the correct approach looks like, with concrete before/after examples.

---

## The Two Patterns

### ✅ Internal / Embedded Orchestration — GOOD

Multi-step logic lives **inside** a DKT action saga. Every step is declared as an array entry; DKT executes them in a single atomic transaction. No external reads happen between steps.

**Mechanisms:**
| Mechanism | Use case |
|-----------|----------|
| Action saga `[{to, fn}, {to, fn}]` | Sequential steps on the same or different models |
| `inline_subwalker: true` | Parent action calls child action in same transaction |
| `sub_flow: true` | Forward to a related model's action transparently |
| `$output` | Pass computed data from one saga step to the next without external read |

**Example — split clip saga (Clip.ts):**

```ts
splitSelfAt: [
  // Step 1: trim the left clip, stash original duration in a scratch attr
  {
    to: ['self'],
    fn: ({ self, payload }) => {
      const originalDuration = self.duration;
      return {
        duration: payload.splitAt - self.startTime,
        splitOriginalDuration: originalDuration,   // ← written to model attr
      };
    },
  },
  // Step 2: ask the owning track to create the right clip
  //         sub_flow: true means this runs inside the SAME transaction
  {
    to: ['<< track', { action: 'splitClipAt', sub_flow: true }],
    fn: ({ self, payload }) => ({
      sourceClipId:     self.id,
      splitAt:          payload.splitAt,
      originalDuration: self.splitOriginalDuration,  // ← read scratch attr
    }),
  },
  // Step 3: clear the scratch attr
  {
    to: ['self'],
    fn: () => ({ splitOriginalDuration: null }),
  },
],
```

Everything happens inside DKT. The runtime calls `dispatch('splitSelfAt', ...)` **once** and never reads state between steps.

---

### ❌ External / Caller-Driven Orchestration — CATEGORICALLY FORBIDDEN

The runtime layer (or any caller — UI component, adapter, test helper) reads model state **between** dispatches and uses that reading to decide what to dispatch next.

**Example — the removed `syncOwnershipRels` (createMiniCutDktRuntime.ts):**

```ts
// ❌ FORBIDDEN — removed in commit 3069e13
async function syncOwnershipRels(appModel: AppModel) {
  const trackModels = queryModelRel(appModel, 'tracks');          // ← read #1

  for (const trackModel of trackModels) {
    const clipModels = queryModelRel(trackModel, 'clips');        // ← read #2

    for (const clipModel of clipModels) {
      await clipModel.dispatch('setTrack', { trackId: trackModel.id });   // ← dispatch A
      await clipModel.dispatch('setProject', { projectId: ... });         // ← dispatch B

      const textModel = queryModelRel(clipModel, 'text');         // ← read #3 (inside loop)
      if (textModel) {
        await textModel.dispatch('setClip', { clipId: clipModel.id });    // ← dispatch C
      }
    }
  }
}

// Called before AND after every dispatch:
async dispatch(action, payload) {
  await syncOwnershipRels(appModel);   // ← pre-sync
  await innerDispatch(action, payload);
  await syncOwnershipRels(appModel);   // ← post-sync
}
```

**Why this is wrong:**

1. **Breaks transaction atomicity.** Each `await dispatch(...)` inside the loop is its own DKT transaction. Intermediate model state is visible between them — concurrent reads can observe a half-updated graph.

2. **Inverts responsibility.** The model is the authority for its own invariants. When ownership sync lives outside the model, any caller that forgets to run the sync leaves the graph inconsistent. There is no single place to audit or test the invariant.

3. **Scales catastrophically.** O(tracks × clips × effects × …) synchronous dispatch loops become O(n²) or worse for large projects. Every action now pays the cost of a full graph scan — even actions unrelated to ownership.

4. **Makes saga composition impossible.** DKT's saga system is designed so that `sub_flow` and `inline_subwalker` propagate context through the model graph in one pass. External loops bypass all of that, making saga-level composition dead code.

5. **Untestable invariants.** A unit test for `splitSelfAt` must now also set up the runtime orchestration wrapper to get correct rel state, instead of testing the model action in isolation.

---

## Root Cause

The mistake stemmed from thinking about ownership relations as "something to sync after mutations" — a background maintenance task. DKT models are not passive data stores; their actions are the place to maintain invariants.

The correct mental model:

> **If model B's rel to model A must change when model A does something, that change must be encoded as a saga step or sub_flow in model A's action — not handled by a caller watching model A.**

---

## Correct Pattern for Ownership Relations

When `Track.splitClipAt` creates a new clip, the new clip's `setTrack` action should be dispatched **inside** `Track.splitClipAt` as a saga step or via `inline_subwalker`:

```ts
// Track.ts
splitClipAt: [
  // Step 1: create the right clip node
  {
    to: ['self'],
    fn: ({ self, payload }) => {
      const rightClip = createClipNode({ ... });
      return { clips: [...self.clips, rightClip] };
    },
  },
  // Step 2: immediately set ownership on the new clip
  //         inline_subwalker dispatches into the child model in the same tx
  {
    to: ['>> clips[-1]', { action: 'setTrack', inline_subwalker: true }],
    fn: ({ self }) => ({ trackId: self.id }),
  },
],
```

The runtime never needs to know that ownership was set. It dispatched one action; the model handled everything.

---

## Checklist: How to Spot the Anti-Pattern

Ask these questions when reviewing code:

- [ ] Does the runtime, adapter, or UI component call `dispatch` more than once in response to a single user action or lifecycle event?
- [ ] Is there a `for` loop that calls `dispatch` for each item in a collection?
- [ ] Does code read `.states`, `.attrs`, or any model accessor **between** two `dispatch` calls?
- [ ] Is there a "sync" function called before or after `dispatch` to "fix up" relations?
- [ ] Does a test need to manually dispatch ownership-setter actions after creating a clip/track/effect?

**If any answer is yes → the logic must move inside a DKT action saga.**

---

## Files Changed

| File | Change |
|------|--------|
| `src/video-editor/dkt/runtime/createMiniCutDktRuntime.ts` | Removed `syncOwnershipRels`, removed pre/post-dispatch sync wrappers |
| `src/video-editor/models/Clip.ts` | Ownership set via `setTrack`/`setProject` actions (available for in-saga use) |
| `src/video-editor/models/Track.ts` | Ownership set via in-model actions |
| `src/video-editor/models/Effect.ts` | `setEffectClip`, `setEffectProject` actions for in-saga use |
| `src/video-editor/models/Text.ts` | `setClip` action for in-saga use |
| `src/video-editor/models/Resource.ts` | `setProject`, `setClips` actions for in-saga use |

---

## Rule (to be enforced in code review)

> **Internal / embedded orchestration** — GOOD. Multi-step logic encoded as a DKT action saga, `inline_subwalker`, `sub_flow`, or `$output`. Runs in one transaction. No external reads.
>
> **External / caller-driven orchestration** — CATEGORICALLY FORBIDDEN. Runtime or UI reads model state between dispatches to decide what to dispatch next. All coordination belongs inside the DKT model layer.
