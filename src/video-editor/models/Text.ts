import { model } from "dkt/model.js";
import {
	reduceSetClipRef,
	reduceSetTextBox,
	reduceSetTextStyle,
	reduceTextContentAction,
} from "./Text/actions";
import { defaultTextBox, defaultTextStyle } from "./Text/defaults";

export const Text = model({
	model_name: "minicut_text",
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
		content: ["input", "Text"],
		style: ["input", defaultTextStyle],
		box: ["input", defaultTextBox],
	},
	rels: {
		clip: ["input", { linking: "<< clip << #" }],
	},
	actions: {
		setTextContent: {
			to: {
				content: ["content"],
			},
			fn: (payload: unknown) => reduceTextContentAction(payload) ?? "$noop",
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
