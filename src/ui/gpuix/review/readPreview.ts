import type { MiniCutReviewItem } from "../../../video-editor/dkt/review/types";

/**
 * The item's preview when it has the shape the feature inspector needs, else
 * null (the inspector then shows a note instead of throwing inside the tree).
 */
export const readPreview = <Preview extends { type: string }>(
	item: MiniCutReviewItem,
	type: Preview["type"],
	hasShape: (preview: Record<string, unknown>) => boolean = () => true,
): Preview | null => {
	const preview = item.preview;
	if (
		!preview ||
		typeof preview !== "object" ||
		Array.isArray(preview) ||
		(preview as { type?: unknown }).type !== type ||
		!hasShape(preview as Record<string, unknown>)
	) {
		return null;
	}
	return preview as Preview;
};
