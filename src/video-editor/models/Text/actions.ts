import type { TextAttrs } from "./types";

export type DktTextActionName =
	| "setTextContent"
	| "setTextStyle"
	| "setTextBox";
export type DktTextActionPatch = Partial<TextAttrs>;

export const reduceTextContentAction = (
	payload: unknown,
): Pick<TextAttrs, "content"> | null => {
	const content =
		typeof payload === "string"
			? payload
			: (payload as { content?: unknown } | null)?.content;
	return typeof content === "string" ? { content } : null;
};

export const reduceTextStyleAction = (
	payload: unknown,
	current: Pick<TextAttrs, "style">,
): Pick<TextAttrs, "style"> | null => {
	const style = (payload as { style?: unknown } | null)?.style ?? payload;
	return style && typeof style === "object"
		? { style: { ...current.style, ...(style as Partial<TextAttrs["style"]>) } }
		: null;
};

export const reduceTextBoxAction = (
	payload: unknown,
	current: Pick<TextAttrs, "box">,
): Pick<TextAttrs, "box"> | null => {
	const box = (payload as { box?: unknown } | null)?.box ?? payload;
	return box && typeof box === "object"
		? { box: { ...current.box, ...(box as Partial<TextAttrs["box"]>) } }
		: null;
};

export const reduceSetTextStyle = (payload: unknown, style: unknown) => {
	const patch = reduceTextStyleAction(payload, {
		style:
			style && typeof style === "object"
				? (style as TextAttrs["style"])
				: ({} as TextAttrs["style"]),
	});
	return patch;
};

export const reduceSetTextBox = (payload: unknown, box: unknown) =>
	reduceTextBoxAction(payload, {
		box:
			box && typeof box === "object"
				? (box as TextAttrs["box"])
				: ({} as TextAttrs["box"]),
	});

export const reduceSetClipRef = (payload: unknown) => ({
	clip: (payload as { clip?: unknown } | null)?.clip ?? null,
});
