import type { MiniCutEffectInterfaces } from "../contracts/effectInterfaces";

/**
 * Interfaces and methods that model effects call. Model effect fns silently
 * skip a missing method, so a host must prove completeness at composition time.
 */
export const REQUIRED_EFFECT_INTERFACE_METHODS = {
	exportRuntime: ["requestExport", "cancelExport"],
	importRuntime: ["requestImportFiles"],
	mediaRecoveryRuntime: ["requestMediaRecovery"],
	playbackRuntime: ["applyPlaybackRun"],
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
	if (missing.length > 0) {
		throw new Error(
			`Incomplete MiniCut effect interfaces: ${missing.join(", ")}`,
		);
	}
}
