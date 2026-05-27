import type { CrdtConflictRecord } from "./types";

export type MiniCutConflictDetails = {
	deleteVsEdit?: unknown;
	danglingResource?: unknown;
	trackOrder?: unknown;
	clipTiming?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const readMiniCutConflictDetails = (
	conflict: Pick<CrdtConflictRecord, "details">,
): MiniCutConflictDetails => {
	const details = isRecord(conflict.details) ? conflict.details : null;
	const minicut = isRecord(details?.minicut) ? details.minicut : null;
	return minicut ?? {};
};

export const withMiniCutConflictDetails = (
	conflict: Record<string, unknown>,
	patch: MiniCutConflictDetails,
): Record<string, unknown> => {
	const details = isRecord(conflict.details) ? conflict.details : {};
	const minicut = isRecord(details.minicut) ? details.minicut : {};
	return {
		...conflict,
		details: {
			...details,
			minicut: {
				...minicut,
				...patch,
			},
		},
	};
};
