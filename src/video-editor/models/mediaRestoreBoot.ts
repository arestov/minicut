import { addr } from "dkt/dcl/addr.js";

/**
 * Boot restore of media (model gap M10). Chain, all local to this runtime:
 * sessions (user attention) -> AppRoot `attendedProjectIds` -> Project
 * `attendedBoot` -> Resource `wantBoot`. The boot stamp is the framework's
 * `$meta$apis$mediaRestoreRuntime$used` on the root: set when the platform
 * attaches the optional interface and reset on reinit, so every runtime boot
 * has its own stamp and a platform without the interface has none.
 */
export const MEDIA_RESTORE_API_READY =
	"$meta$apis$mediaRestoreRuntime$deps_ready";
export const MEDIA_RESTORE_API_USED = "$meta$apis$mediaRestoreRuntime$used";

export const rootAttr = (attr: string) =>
	addr({ relPath: ["$root"], attr, zip: "one" });

export const reduceProjectAttended = (ids: unknown, id: unknown): boolean =>
	typeof id === "string" && Array.isArray(ids) && ids.includes(id);

/** Stamp of the current boot when the project is attended and the platform can restore. */
export const reduceProjectAttendedBoot = (
	attended: unknown,
	ready: unknown,
	stamp: unknown,
): string | number | null =>
	attended === true &&
	ready === true &&
	(typeof stamp === "string" || typeof stamp === "number") &&
	stamp !== "" &&
	stamp !== 0
		? stamp
		: null;

/** Stamp usable as `doneBoot` / `bootId`, or null when the platform has no boot. */
export const bootStampOrNull = (stamp: unknown): string | number | null =>
	(typeof stamp === "string" && stamp !== "") ||
	(typeof stamp === "number" && stamp !== 0)
		? stamp
		: null;

type BootRestoreData = { next_value?: unknown } | null;

/**
 * `handleAttr:wantBoot` gate: one restore start per resource per boot. The
 * result is the `startMediaRecovery` payload plus the `doneBoot` mark.
 */
export const reduceBootRestoreStart = (
	data: unknown,
	noop: unknown,
	doneBoot: unknown,
	resourceId: unknown,
	now: unknown,
) => {
	const stamp = bootStampOrNull((data as BootRestoreData)?.next_value);
	if (stamp === null || doneBoot === stamp || typeof resourceId !== "string") {
		return noop;
	}
	const operationId = `restore:${String(stamp)}:${resourceId}`;
	return {
		doneBoot: stamp,
		start: {
			operationId,
			attemptId: operationId,
			bootId: String(stamp),
			recoveryKind: "restore",
			intent: "restore",
			createdAt: now,
			updatedAt: now,
		},
	};
};
