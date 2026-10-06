/**
 * Presentation of resource attrs as short labels. Each label comes from one
 * model attr value; nothing here combines resources or looks at other nodes.
 */
export type ResourceNote = { label: string; tone: "warning" | "danger" | "info" };

type ResourceMediaAttrs = {
	status?: unknown;
	localMediaAvailability?: unknown;
	originalAccessStatus?: unknown;
};

// guard-ok: pending model comp attr (M7: Resource display note)
export const describeResourceNote = (
	attrs: ResourceMediaAttrs,
): ResourceNote | null => {
	switch (attrs.originalAccessStatus) {
		case "missing":
			return { label: "File missing", tone: "danger" };
		case "denied":
			return { label: "Access denied", tone: "danger" };
		case "prompt":
			return { label: "Needs permission", tone: "warning" };
	}
	if (attrs.status === "needs-permission") {
		return { label: "Needs permission", tone: "warning" };
	}
	if (attrs.status === "missing") {
		return { label: "Source missing", tone: "danger" };
	}
	if (attrs.localMediaAvailability === "ready-project-copy") {
		return { label: "Using project copy", tone: "info" };
	}
	return null;
};

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
