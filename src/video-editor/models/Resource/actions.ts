import { numberOr, numberOrNull, objectOr, stringOr } from "../valueGuards";

export const reduceRenameResource = (payload: unknown) => {
	const name =
		typeof payload === "string"
			? payload
			: (payload as { name?: unknown } | null)?.name;
	return typeof name === "string" && name ? { name } : null;
};

export const reduceSetResourceStatus = (payload: unknown) => {
	const status =
		typeof payload === "string"
			? payload
			: (payload as { status?: unknown } | null)?.status;
	return status === "missing" ||
		status === "partial" ||
		status === "ready" ||
		status === "loading" ||
		status === "error"
		? { status }
		: null;
};

export const reduceSetResourceAttrs = (payload: unknown) => {
	const value = payload as Record<string, unknown> | null;
	if (!value || typeof value !== "object") {
		return null;
	}

	return {
		name: stringOr(value.name, "Resource"),
		kind: stringOr(value.kind, "video"),
		url: stringOr(value.url, ""),
		mime: stringOr(value.mime, "application/octet-stream"),
		duration: numberOr(value.duration, 0),
		width: numberOrNull(value.width),
		height: numberOrNull(value.height),
		size: numberOrNull(value.size),
		source: objectOr(value.source, { kind: "local" }),
		status: stringOr(value.status, "missing"),
		data: objectOr(value.data, null),
	};
};

export const reduceRequestAddToTimeline = (payload: unknown) => ({
	timelineAddRequest: {
		resourceId:
			typeof (payload as { resourceId?: unknown } | null)?.resourceId ===
			"string"
				? (payload as { resourceId: string }).resourceId
				: null,
		requestedAt: Date.now(),
	},
});

export const reduceSetProjectRef = (payload: unknown) => ({
	project: (payload as { project?: unknown } | null)?.project ?? null,
});

export const reduceSetClipsRef = (payload: unknown) => ({
	clips: Array.isArray((payload as { clips?: unknown } | null)?.clips)
		? (payload as { clips: unknown[] }).clips
		: [],
});
