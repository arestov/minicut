import { makeCrdtResolvePayload } from "../../dkt/review/crdtReviewCommands";
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
		status === "needs-permission" ||
		status === "ready" ||
		status === "partial" ||
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
		lastModified: numberOrNull(value.lastModified),
		sourceKind: stringOr(value.sourceKind, "missing"),
		sourceRef:
			typeof value.sourceRef === "string" && value.sourceRef
				? value.sourceRef
				: null,
		source: objectOr(value.source, { kind: "local" }),
		status: stringOr(value.status, "missing"),
		data: objectOr(value.data, null),
		assetStorageKind: value.assetStorageKind === "project-copy" ? "project-copy" : "linked",
		assetRef: typeof value.assetRef === "string" && value.assetRef ? value.assetRef : null,
		contentFingerprint: typeof value.contentFingerprint === "string" && value.contentFingerprint ? value.contentFingerprint : null,
		fingerprintVersion: typeof value.fingerprintVersion === "string" && value.fingerprintVersion ? value.fingerprintVersion : null,
		localMediaStatus: typeof value.localMediaStatus === "string" ? value.localMediaStatus : "unknown",
	};
};

export const reduceRequestAddToTimeline = (payload: unknown, now: unknown) => ({
	timelineAddRequest: {
		resourceId:
			typeof (payload as { resourceId?: unknown } | null)?.resourceId ===
			"string"
				? (payload as { resourceId: string }).resourceId
				: null,
		requestedAt: typeof now === "number" && Number.isFinite(now) ? now : 0,
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

const asObject = <Value extends object>(value: unknown): Value | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Value)
		: null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];

const getNodeId = (model: unknown): string | null =>
	model &&
	typeof model === "object" &&
	typeof (model as { _node_id?: unknown })._node_id === "string"
		? (model as { _node_id: string })._node_id
		: null;

const clipIdsFromRefs = (clips: unknown): string[] =>
	Array.isArray(clips)
		? clips.flatMap((clip) => {
				const clipId = getNodeId(clip);
				return clipId ? [clipId] : [];
			})
		: [];

const resourcePayloadIds = (value: Record<string, unknown>) => ({
	conflictId: asString(value.conflictId) ?? asString(value.conflict_id),
	reviewItemId:
		asString(value.reviewItemId) ?? asString(value.review_item_id),
	resourceId: asString(value.resourceId) ?? asString(value.resource_id),
});

const isPortableSourceUrl = (url: string): boolean =>
	url.startsWith("http://") ||
	url.startsWith("https://") ||
	url.startsWith("data:");

const portableSourceFromRelink = (
	source: Record<string, unknown>,
	replacementUrl: string,
	conflictId: string,
) => {
	const nextSource = { ...source };
	if (isPortableSourceUrl(replacementUrl)) {
		nextSource.url = replacementUrl;
	} else {
		delete nextSource.url;
		nextSource.localOnlyUrl = true;
	}
	nextSource.relinkedFromConflictId = conflictId;
	return nextSource;
};

export const reduceResolveDanglingResourceByRelink = (
	payload: unknown,
	resource: unknown,
	clips: unknown,
) => {
	const value = asObject<Record<string, unknown>>(payload);
	if (!value) return null;
	const ids = resourcePayloadIds(value);
	const replacementUrl =
		asString(value.replacementUrl) ??
		asString(value.url) ??
		asString(value.sourceUrl);
	const source =
		asObject<Record<string, unknown>>(value.source) ??
		(replacementUrl
			? { kind: asString(value.sourceKind) ?? "external", url: replacementUrl }
			: null);
	const resourceId = getNodeId(resource);
	if (
		!ids.conflictId ||
		!ids.reviewItemId ||
		!ids.resourceId ||
		!resourceId ||
		ids.resourceId !== resourceId ||
		!replacementUrl ||
		!source
	) {
		return null;
	}
	const affectedClipIds = [
		...new Set([
			...asStringArray(value.affectedClipIds),
			...asStringArray(value.clipIds),
			...clipIdsFromRefs(clips),
		]),
	];
	const data = objectOr(value.data, {});
	const sourceKind = asString(source.kind) ?? "external";
	const portableSource = portableSourceFromRelink(
		source,
		replacementUrl,
		ids.conflictId,
	);
	return {
		"$meta$removed": false,
		url: replacementUrl,
		status: "ready",
		source: portableSource,
		data,
		crdtResolve: makeCrdtResolvePayload({
			conflictId: ids.conflictId,
			reviewItemId: ids.reviewItemId,
			action: "resolveDanglingResourceByRelink",
			domainResult: {
					type: "resource_relinked",
					resourceId,
					replacementUrl: isPortableSourceUrl(replacementUrl)
						? replacementUrl
						: null,
					localOnlyUrl: !isPortableSourceUrl(replacementUrl),
					sourceKind,
					affectedClipIds,
				},
		}),
	};
};

export const reduceKeepOfflinePlaceholder = (
	payload: unknown,
	resource: unknown,
	clips: unknown,
	source: unknown,
) => {
	const value = asObject<Record<string, unknown>>(payload);
	if (!value) return null;
	const ids = resourcePayloadIds(value);
	const resourceId = getNodeId(resource);
	if (
		!ids.conflictId ||
		!ids.reviewItemId ||
		!ids.resourceId ||
		!resourceId ||
		ids.resourceId !== resourceId
	) {
		return null;
	}
	const affectedClipIds = [
		...new Set([
			...asStringArray(value.affectedClipIds),
			...asStringArray(value.clipIds),
			...clipIdsFromRefs(clips),
		]),
	];
	return {
		"$meta$removed": false,
		status: "offline",
		source: {
			...objectOr(source, {}),
			kind: "offline_placeholder",
			keptFromConflictId: ids.conflictId,
		},
		crdtResolve: makeCrdtResolvePayload({
			conflictId: ids.conflictId,
			reviewItemId: ids.reviewItemId,
			action: "keepOfflinePlaceholder",
			domainResult: {
				type: "offline_placeholder_kept",
				resourceId,
				affectedClipIds,
			},
		}),
	};
};
