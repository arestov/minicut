import { model } from "dkt/model.js";
import {
	reduceSetClipRef,
	reduceSetTextBox,
	reduceSetTextStyle,
	reduceTextContentAction,
} from "./Text/actions";
import { defaultTextBox, defaultTextStyle } from "./Text/defaults";

export const Text = model({
	model_name: "text",
	aggregates: {
		textBoxStyle: {
			kind: "group",
		},
	},
	crdt: {
		mode: "collaborative",
		attrs: {
			content: "lww",
			style: "lww",
			box: "lww",
		},
		rels: {
			clip: "lww",
		},
	},
	attrs: {
		renderAttrs: [
			"comp",
			["content", "style", "box"] as const,
			(content: unknown, style: unknown, box: unknown) => ({
				content: typeof content === "string" ? content : "",
				style:
					style && typeof style === "object"
						? (style as Record<string, unknown>)
						: {},
				box:
					box && typeof box === "object"
						? (box as Record<string, unknown>)
						: {},
			}),
		],
		content: [
			"input",
			"Text",
			{ aggregate: { name: "textBoxStyle", as: "content", conflictAnchor: true } },
		],
		style: [
			"input",
			defaultTextStyle,
			{ aggregate: { name: "textBoxStyle", as: "style" } },
		],
		box: [
			"input",
			defaultTextBox,
			{ aggregate: { name: "textBoxStyle", as: "box" } },
		],
	},
	rels: {
		clip: [
			"input",
			{
				linking: "<< clip << #",
				role: "nav",
				inverseRel: "text",
			},
		],
	},
	actions: {
		setTextContent: {
			to: {
				content: ["content"],
			},
			fn: [
				["$noop"] as const,
				(payload: unknown, noop: unknown) =>
					reduceTextContentAction(payload) ?? noop,
			],
		},
		setTextStyle: {
			to: {
				style: ["style"],
			},
			fn: [["style"] as const, reduceSetTextStyle],
		},
		setTextBox: {
			to: {
				box: ["box"],
			},
			fn: [["box"] as const, reduceSetTextBox],
		},
		setClip: {
			to: {
				clip: ["<< clip", { method: "set_one" }],
			},
			fn: reduceSetClipRef,
		},
	},
});

export const TEXT_CREATION_SHAPE = {
	attrs: ["content", "style", "box"],
	rels: {
		clip: {},
	},
} as const;
