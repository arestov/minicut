import type { MiniCutEffectInterfaces } from "../contracts/effectInterfaces";

/**
 * Interfaces and methods that model effects call. Model effect fns silently
 * skip a missing method, so a host must prove completeness at composition time.
 */
export const REQUIRED_EFFECT_INTERFACE_METHODS = {
	exportRuntime: ["requestExport", "cancelExport"],
	importRuntime: ["requestImportFiles"],
	mediaRecoveryRuntime: ["requestMediaRecovery", "publishMediaPublicationDecision", "releaseMediaPublication"],
	playbackRuntime: ["applyPlaybackRun"],
} as const satisfies Partial<
	Record<keyof MiniCutEffectInterfaces, readonly string[]>
>;

/**
 * Interfaces a platform may omit. Absent is legal; when present, every listed
 * flag must be implemented like a required interface.
 */
export const OPTIONAL_EFFECT_INTERFACE_FLAGS = {
	mediaRestoreRuntime: ["restoresMediaAtBoot"],
} as const satisfies Partial<
	Record<keyof MiniCutEffectInterfaces, readonly string[]>
>;

export function assertEffectInterfacesComplete(
	interfaces: unknown,
): asserts interfaces is MiniCutEffectInterfaces {
	const missing: string[] = [];
	const source = (interfaces ?? {}) as Record<string, unknown>;
	for (const [name, methods] of Object.entries(
		REQUIRED_EFFECT_INTERFACE_METHODS,
	)) {
		const api = source[name] as Record<string, unknown> | null | undefined;
		if (!api || typeof api !== "object") {
			missing.push(`${name} (missing interface)`);
			continue;
		}
		for (const method of methods) {
			if (typeof api[method] !== "function") {
				missing.push(`${name}.${method}`);
			}
		}
	}
	for (const [name, flags] of Object.entries(OPTIONAL_EFFECT_INTERFACE_FLAGS)) {
		if (source[name] === undefined) continue;
		const api = source[name] as Record<string, unknown> | null;
		if (!api || typeof api !== "object") {
			missing.push(`${name} (declared but not an object)`);
			continue;
		}
		for (const flag of flags) {
			if (api[flag] !== true) missing.push(`${name}.${flag}`);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`Incomplete MiniCut effect interfaces: ${missing.join(", ")}`,
		);
	}
}
