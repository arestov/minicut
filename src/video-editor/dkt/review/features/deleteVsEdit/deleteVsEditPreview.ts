export type DeleteVsEditDeletedVariant = {
	clipId: string;
	resourceId?: string;
	deletedAt?: number;
	peerId?: string;
};

export type DeleteVsEditEditedVariant = {
	clipAttrs: Record<string, unknown>;
	resourceAttrs?: Record<string, unknown>;
	effectAttrs?: Array<Record<string, unknown>>;
	timing?: Record<string, unknown>;
};

export type DeleteVsEditPreview = {
	type: "delete_vs_edit";
	deletedVariant: DeleteVsEditDeletedVariant;
	editedVariant: DeleteVsEditEditedVariant;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringOrUndefined = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const numberOrUndefined = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const recordOrUndefined = (
	value: unknown,
): Record<string, unknown> | undefined => (isRecord(value) ? value : undefined);

const recordArrayOrUndefined = (
	value: unknown,
): Array<Record<string, unknown>> | undefined =>
	Array.isArray(value) ? value.filter(isRecord) : undefined;

const firstRecord = (...values: unknown[]): Record<string, unknown> | undefined =>
	values.find(isRecord) as Record<string, unknown> | undefined;

export const extractDeleteVsEditPreview = (input: {
	payload?: unknown;
	details?: unknown;
	variants?: unknown;
	nodeId?: string | null;
	originPeerId?: string | null;
	happenedAt?: number | null;
}): DeleteVsEditPreview => {
	const payload = recordOrUndefined(input.payload);
	const details = recordOrUndefined(input.details);
	const variants = recordOrUndefined(input.variants);
	const deleted = firstRecord(
		payload?.deleted,
		payload?.tombstone,
		variants?.deleted,
		variants?.tombstone,
		details?.deleted,
	);
	const edited = firstRecord(
		payload?.edited,
		payload?.edit,
		payload?.concurrent,
		variants?.edited,
		variants?.incoming,
		details?.edited,
	);
	const clipAttrs =
		recordOrUndefined(edited?.clipAttrs) ??
		recordOrUndefined(edited?.clip_attrs) ??
		recordOrUndefined(edited?.attrs) ??
		recordOrUndefined(edited) ??
		{};
	const resourceAttrs =
		recordOrUndefined(edited?.resourceAttrs) ??
		recordOrUndefined(edited?.resource_attrs);
	const timing =
		recordOrUndefined(edited?.timing) ??
		(["start", "in", "duration", "fadeIn", "fadeOut"].some(
			(field) => clipAttrs[field] !== undefined,
		)
			? {
					start: clipAttrs.start,
					in: clipAttrs.in,
					duration: clipAttrs.duration,
					fadeIn: clipAttrs.fadeIn,
					fadeOut: clipAttrs.fadeOut,
				}
			: undefined);
	const clipId =
		stringOrUndefined(deleted?.clipId) ??
		stringOrUndefined(deleted?.clip_id) ??
		stringOrUndefined(clipAttrs.clipId) ??
		stringOrUndefined(clipAttrs.clip_id) ??
		stringOrUndefined(input.nodeId) ??
		"";
	return {
		type: "delete_vs_edit",
		deletedVariant: {
			clipId,
			resourceId:
				stringOrUndefined(deleted?.resourceId) ??
				stringOrUndefined(deleted?.resource_id) ??
				stringOrUndefined(resourceAttrs?.resourceId) ??
				stringOrUndefined(resourceAttrs?.resource_id),
			deletedAt:
				numberOrUndefined(deleted?.deletedAt) ??
				numberOrUndefined(deleted?.deleted_at) ??
				numberOrUndefined(input.happenedAt),
			peerId:
				stringOrUndefined(deleted?.peerId) ??
				stringOrUndefined(deleted?.peer_id) ??
				stringOrUndefined(input.originPeerId),
		},
		editedVariant: {
			clipAttrs,
			...(resourceAttrs ? { resourceAttrs } : null),
			...(recordArrayOrUndefined(edited?.effectAttrs) ??
			recordArrayOrUndefined(edited?.effect_attrs)
				? {
						effectAttrs:
							recordArrayOrUndefined(edited?.effectAttrs) ??
							recordArrayOrUndefined(edited?.effect_attrs),
					}
				: null),
			...(timing ? { timing } : null),
		},
	};
};
