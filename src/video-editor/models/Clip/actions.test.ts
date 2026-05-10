import { describe, expect, it } from "vitest";
import {
	normalizeEffectCreationAttrs,
	removeEffectRef,
	reorderEffectRefs,
} from "./actions";

const modelRef = (_node_id: string) => ({ _node_id });

describe("Clip model structural actions", () => {
	it("normalizes effect creation attrs", () => {
		expect(
			normalizeEffectCreationAttrs({
				name: "Blur",
				kind: "blur",
				amount: 0.2,
			}),
		).toMatchObject({
			name: "Blur",
			kind: "blur",
			amount: 0.2,
		});
		expect(normalizeEffectCreationAttrs({ kind: "blur" })).toMatchObject({
			kind: "blur",
			name: "Blur",
			enabled: true,
		});
	});

	it("removes and reorders effect refs by DKT node id", () => {
		const effects = [
			modelRef("effect:one"),
			modelRef("effect:two"),
			modelRef("effect:three"),
		];
		expect(removeEffectRef(effects, "effect:two")).toEqual([
			modelRef("effect:one"),
			modelRef("effect:three"),
		]);
		expect(reorderEffectRefs(effects, "effect:three", 0)).toEqual([
			modelRef("effect:three"),
			modelRef("effect:one"),
			modelRef("effect:two"),
		]);
		expect(reorderEffectRefs(effects, "effect:missing", 0)).toBeNull();
	});
});
