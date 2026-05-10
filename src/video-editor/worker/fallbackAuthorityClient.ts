import type { EditorAuthorityClient } from "./authorityClient";
import {
	canUseDktSharedWorkerAuthority,
	DktSharedWorkerAuthorityClient,
} from "./dktSharedWorkerClient";
import { MemoryWorkerAuthority } from "./memoryWorker";

/**
 * Phase 1 hard rewrite: DKT-only fallback authority client.
 * Attempts SharedWorker, falls back to in-process MemoryWorkerAuthority.
 * No registry snapshot, no command dispatch, no patch listeners.
 */
export const createFallbackAuthorityClient = (
	options: { workerUrl?: string | URL; name?: string } = {},
): EditorAuthorityClient => {
	let active!: EditorAuthorityClient;
	let usingFallback = false;

	const switchToMemory = (reason: unknown): void => {
		if (usingFallback) {
			return;
		}

		usingFallback = true;
		console.warn(
			"[minicut:worker] Falling back to in-memory authority",
			reason,
		);
		try {
			active.destroy?.();
		} catch {
			// noop
		}
		active = new MemoryWorkerAuthority();
	};

	if (canUseDktSharedWorkerAuthority()) {
		try {
			active = new DktSharedWorkerAuthorityClient({
				workerUrl: options.workerUrl,
				name: options.name,
				onError: switchToMemory,
			});
		} catch (error) {
			console.warn(
				"[minicut:worker] DKT SharedWorker construction failed",
				error,
			);
			active = new MemoryWorkerAuthority();
			usingFallback = true;
		}
	} else {
		active = new MemoryWorkerAuthority();
		usingFallback = true;
	}

	return {
		openDktTransport() {
			return active.openDktTransport();
		},
		subscribeDktSync(listener) {
			return active.subscribeDktSync?.(listener) ?? (() => {});
		},
		flushDktSync() {
			return active.flushDktSync?.() ?? Promise.resolve();
		},
		destroy() {
			active.destroy?.();
		},
	};
};
