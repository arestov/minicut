import { describe, expect, it } from "vitest";
import { createActionContractHarness, dispatchAndSettle } from "./action-contract-test-harness";

describe("color correction projection", () => {
 it("preserves every matching identity and source order through kind, reorder and removal", async () => {
  const { ctx, videoClip: clip } = await createActionContractHarness();
  const dispatch = (target: typeof clip, action: string, payload: unknown) => dispatchAndSettle(ctx, target, action, payload);
  const check = async (expected: typeof clip[]) => {
   expect(await ctx.queryRel(clip, "colorCorrectionEffects")).toEqual(expected);
   expect(await ctx.queryAttr(clip, "$meta$rels$colorCorrectionEffects$length")).toBe(expected.length);
   expect(await ctx.queryAttr(clip, "$meta$rels$colorCorrectionEffects$exists")).toBe(expected.length > 0);
  };
  await check([]);
  await dispatch(clip, "addEffect", {kind: "blur", name: "blur"});
  await check([]);
  await dispatch(clip, "addEffect", {kind: "color-correction", name: "A", enabled: false});
  await dispatch(clip, "addEffect", {kind: "tint", name: "tint"});
  await dispatch(clip, "addEffect", {kind: "color-correction", name: "B"});
  const [blur, a, tint, b] = await ctx.queryRel(clip, "effects");
  await check([a,b]);
  expect(await ctx.queryAttr(a, "enabled")).toBe(false);
  await dispatch(blur, "setEffectKind", {kind: "color-correction"});
  await check([blur,a,b]);
  await dispatch(blur, "setEffectKind", {kind: "blur"});
  await check([a,b]);
  await dispatch(clip, "reorderEffect", {effectId: b._node_id, toIndex: 0});
  await check([b,a]);
  await dispatch(clip, "removeEffect", {effectId: b._node_id});
  await check([a]);
  await dispatch(clip, "removeEffect", {effectId: a._node_id});
  await check([]);
  expect(await ctx.queryRel(clip, "effects")).toEqual([blur,tint]);
 });
});
