import { describe, expect, it } from "vitest";
import { reducePatchEffectParamsAction } from "../../models/Effect/actions";
import { createActionContractHarness, dispatchAndSettle } from "./action-contract-test-harness";

describe("Effect.patchEffectParams", () => {
 it("accepts undefined and malformed bases without changing wrapped-delta validation", () => {
  for (const base of [undefined, null, [], 3]) {
   expect(reducePatchEffectParamsAction({params:{exposure:{value:.2}}},base)).toEqual({params:{exposure:{value:.2}}});
  }
 });
 it("merges authority deltas shallowly and preserves the replacement API", async () => {
  const {ctx, videoClip: clip} = await createActionContractHarness();
  await dispatchAndSettle(ctx, clip, "addEffect", {kind: "color-correction"});
  const [effect] = await ctx.queryRel(clip, "effects");
  const patch = (payload: unknown) => dispatchAndSettle(ctx, effect, "patchEffectParams", payload);
  const read = () => ctx.queryAttr(effect, "params");
  expect(await read()).toBeNull(); // Public queryAttr normalizes absent values to null.
  await patch({params:{exposure:{value:.1,keyframes:["old"]},contrast:{value:1.2},unknown:{keep:1}}});
  await patch({params:{exposure:{value:.2}}});
  await patch({params:{temperature:{value:.3}}});
  const expected = {exposure:{value:.2},contrast:{value:1.2},unknown:{keep:1},temperature:{value:.3}};
  expect(await read()).toEqual(expected);
  for (const invalid of [undefined, null, [], {}, {params:null}, {params:[]}, {params:{}}, {params:3}, {exposure:1}]) {
   await patch(invalid);
   expect(await read()).toEqual(expected);
  }
  await dispatchAndSettle(ctx, effect, "setEffectParams", {params:{only:1}});
  expect(await read()).toEqual({only:1});
  await dispatchAndSettle(ctx, effect, "setEffectParams", {direct:2});
  expect(await read()).toEqual({direct:2});
 });
});
