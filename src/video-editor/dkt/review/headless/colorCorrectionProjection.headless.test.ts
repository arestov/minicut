import { describe, expect, it } from "vitest";
import { createHeadlessReviewPair } from "./createHeadlessReviewPair";

describe("remote correction projection without a mounted Color panel", () => {
 it("derives remotely created scopes, kind changes, order and removal", async () => {
  const pair = await createHeadlessReviewPair("room-color-correction-projection");
  try {
   await pair.a.dispatch(pair.a.videoTrack, "addClip", {name:"remote color", mediaKind:"video", start:0, in:0, duration:4});
   await pair.waitForConvergence();
   const [a] = await pair.a.queryVideoClips();
   const [b] = await pair.b.queryVideoClips();
   expect(b._node_id).toBe(a._node_id);
   for (const kind of ["blur", "color-correction", "tint", "color-correction"]) {
    await pair.a.dispatch(a, "addEffect", {kind, enabled:false});
   }
   const [blur, first, tint, last] = await pair.a.ctx.queryRel(a, "effects");
   const read = async (ids: string[]) => {
    await pair.waitForConvergence();
    await pair.b.ctx.computed();
    const scopes = await pair.b.ctx.queryRel(b, "colorCorrectionEffects");
    expect(scopes.map(item => String(item._node_id))).toEqual(ids);
    expect(await pair.b.ctx.queryAttr(b, "$meta$rels$colorCorrectionEffects$exists")).toBe(ids.length > 0);
    expect(await pair.b.ctx.queryAttr(b, "$meta$rels$colorCorrectionEffects$length")).toBe(ids.length);
   };
   const id = (effect: typeof a) => String(effect._node_id);
   await read([id(first),id(last)]);
   await pair.a.dispatch(blur, "setEffectKind", {kind:"color-correction"});
   await read([id(blur),id(first),id(last)]);
   await pair.a.dispatch(blur, "setEffectKind", {kind:"blur"});
   await pair.a.dispatch(a, "reorderEffect", {effectId:id(last),toIndex:0});
   await read([id(last),id(first)]);
   await pair.a.dispatch(a, "removeEffect", {effectId:id(last)});
   await read([id(first)]);
   await pair.a.dispatch(a, "removeEffect", {effectId:id(first)});
   await read([]);
   expect((await pair.b.ctx.queryRel(b, "effects")).map(item => String(item._node_id))).toEqual([id(blur),id(tint)]);
  } finally { pair.close(); }
 });
});
