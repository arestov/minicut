import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import { createMiniCutDktRuntime } from "../dkt/runtime/createMiniCutDktRuntime";
import type { MiniCutDktTransportMessage } from "../dkt/shared/messageTypes";
import type { EditorAuthorityClient } from "./authorityClient";

/**
 * Phase 1 hard rewrite: MemoryWorkerAuthority is now a thin DKT-only transport.
 * No registry state, no patch listeners, no command dispatch.
 * Provides openDktTransport() using an in-process DKT runtime.
 */
export class MemoryWorkerAuthority implements EditorAuthorityClient {
	#dktRuntime = createMiniCutDktRuntime({ enabled: true });

	openDktTransport(): DomSyncTransportLike<MiniCutDktTransportMessage> {
		const pageListeners = new Set<
			(message: MiniCutDktTransportMessage) => void
		>();
		const workerListeners = new Set<
			(message: MiniCutDktTransportMessage) => void
		>();
		const connection = this.#dktRuntime.connect({
			send(message) {
				for (const listener of pageListeners) {
					listener(message);
				}
			},
			listen(listener) {
				workerListeners.add(listener);
				return () => {
					workerListeners.delete(listener);
				};
			},
			destroy() {
				workerListeners.clear();
			},
		});

		return {
			send(message) {
				for (const listener of [...workerListeners]) {
					listener(message);
				}
			},
			listen(listener) {
				pageListeners.add(listener);
				return () => {
					pageListeners.delete(listener);
				};
			},
			destroy() {
				pageListeners.clear();
				workerListeners.clear();
				connection.destroy();
			},
		};
	}

	destroy(): void {
		// DKT runtime cleans up when connections are destroyed
	}
}
