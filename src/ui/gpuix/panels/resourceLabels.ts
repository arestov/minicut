/**
 * Presentation of resource attrs as short labels. Each label comes from one
 * model attr value; nothing here combines resources or looks at other nodes.
 */
export type ResourceNote = { label: string; tone: "warning" | "danger" | "info" };

export const formatDuration = (value: unknown): string =>
	typeof value === "number" && Number.isFinite(value)
		? `${value.toFixed(1)}s`
		: "-";

export const formatSize = (value: unknown): string | null =>
	typeof value === "number" && value > 0
		? value >= 1_048_576
			? `${(value / 1_048_576).toFixed(1)} MB`
			: `${Math.round(value / 1024)} KB`
		: null;
