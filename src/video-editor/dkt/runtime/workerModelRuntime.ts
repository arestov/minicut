import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import { createMiniCutDktRuntime } from "./createMiniCutDktRuntime";

const isCrdtTestHarnessEnabled = (): boolean =>
	import.meta.env.VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS === "1" ||
	import.meta.env.VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS === "true";

export const createMiniCutDktWorkerModelRuntime = () => {
	const enableCrdtTestHarness = isCrdtTestHarnessEnabled();
	const runtime = createMiniCutDktRuntime({
		enabled: true,
		crdt: enableCrdtTestHarness ? true : false,
		unloadModels: enableCrdtTestHarness,
	});
	const activeSessionKeys = new Set<string>();
	const activeConnections = new Set<{ destroy(): void }>();

	const connect = (
		transport: DomSyncTransportLike<MiniCutDktTransportMessage>,
	) => {
		let sessionKey: string | null = null;
		const unlisten = transport.listen((message) => {
			if (
				message.type === DKT_MSG.BOOTSTRAP &&
				typeof message.sessionKey === "string"
			) {
				sessionKey = message.sessionKey;
				activeSessionKeys.add(message.sessionKey);
			}
			if (message.type === DKT_MSG.CLOSE_SESSION && sessionKey) {
				activeSessionKeys.delete(sessionKey);
				sessionKey = null;
			}
		});
		const connection = runtime.connect(transport);
		const trackedConnection = {
			destroy(): void {
				if (sessionKey) {
					activeSessionKeys.delete(sessionKey);
					sessionKey = null;
				}
				unlisten();
				activeConnections.delete(trackedConnection);
				connection.destroy();
			},
		};
		activeConnections.add(trackedConnection);
		return trackedConnection;
	};

	const destroy = (): void => {
		for (const connection of [...activeConnections]) {
			connection.destroy();
		}
		activeSessionKeys.clear();
	};

	return {
		runtime,
		connect,
		destroy,
		getActiveSessionKeys: () => [...activeSessionKeys],
		getConnectionCount: () => activeConnections.size,
		getRuntimeSnapshot: () => runtime.debugDumpState(),
	};
};
