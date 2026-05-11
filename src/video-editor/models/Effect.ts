import { model } from "dkt/model.js";
import type { EffectRenderInstruction } from "../render/colorPipeline";
import {
	reduceEffectAmountAction,
	reduceEffectColorAction,
	reduceEffectEnabledAction,
	reduceEffectKindAction,
	reduceEffectNameAction,
	reduceEffectParamsAction,
	reduceSetEffectClip,
	reduceSetEffectProject,
} from "./Effect/actions";
import { defaultEffectAttrs } from "./Effect/defaults";

const _asStr = (v: unknown, fb: string): string =>
	typeof v === "string" && v ? v : fb;
const _asBool = (v: unknown): boolean => v !== false;

export const Effect = model({
	model_name: "effect",
	attrs: {
		renderInstruction: [
			"comp",
			["kind", "name", "enabled", "amount", "params", "color"] as const,
			(
				kind: unknown,
				name: unknown,
				enabled: unknown,
				amount: unknown,
				params: unknown,
				color: unknown,
			): EffectRenderInstruction => ({
				kind: _asStr(kind, "blur") as EffectRenderInstruction["kind"],
				name: _asStr(name, "Effect"),
				enabled: _asBool(enabled),
				...(typeof amount === "number" && Number.isFinite(amount)
					? { amount }
					: {}),
				...(params && typeof params === "object"
					? { params: params as Record<string, unknown> }
					: {}),
				...(color && typeof color === "object"
					? { color: color as Record<string, unknown> }
					: {}),
			}),
		],
		name: ["input", defaultEffectAttrs.name],
		kind: ["input", defaultEffectAttrs.kind],
		enabled: ["input", defaultEffectAttrs.enabled],
		amount: ["input", defaultEffectAttrs.amount],
		params: ["input", defaultEffectAttrs.params],
		color: ["input", defaultEffectAttrs.color],
	},
	rels: {
		clip: ["input", { linking: "<< clip << #" }],
		project: ["input", { linking: "<< project << #" }],
	},
	actions: {
		setEffectName: {
			to: {
				name: ["name"],
			},
			fn: (payload: unknown) => reduceEffectNameAction(payload) ?? "$noop",
		},
		setEffectKind: {
			to: {
				kind: ["kind"],
			},
			fn: (payload: unknown) => reduceEffectKindAction(payload) ?? "$noop",
		},
		setEffectEnabled: {
			to: {
				enabled: ["enabled"],
			},
			fn: (payload: unknown) => reduceEffectEnabledAction(payload) ?? "$noop",
		},
		setEffectAmount: {
			to: {
				amount: ["amount"],
			},
			fn: (payload: unknown) => reduceEffectAmountAction(payload) ?? "$noop",
		},
		setEffectParams: {
			to: {
				params: ["params"],
			},
			fn: (payload: unknown) => reduceEffectParamsAction(payload) ?? "$noop",
		},
		setEffectColor: {
			to: {
				color: ["color"],
			},
			fn: (payload: unknown) => reduceEffectColorAction(payload) ?? "$noop",
		},
		setEffectClip: {
			to: {
				clip: ["<< clip", { method: "set_one" }],
			},
			fn: reduceSetEffectClip,
		},
		setEffectProject: {
			to: {
				project: ["<< project", { method: "set_one" }],
			},
			fn: reduceSetEffectProject,
		},
	},
});

export const EFFECT_CREATION_SHAPE = {
	attrs: ["name", "kind", "enabled", "amount", "params", "color"],
	rels: {
		clip: {},
	},
} as const;
