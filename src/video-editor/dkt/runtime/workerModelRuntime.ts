import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";
import type { DktCrdtTransport, DktCrdtWireMessage } from "../crdt/testRelayContracts";
import {
	createMiniCutHarnessWorkspaceId,
	createMiniCutWorkspaceDbName,
} from "../storage/minicutWorkspaceManifest";
import {
	createMiniCutDktRuntime,
	type MiniCutCrdtTransport,
} from "./createMiniCutDktRuntime";

const cloneWireMessage = (message: DktCrdtWireMessage): DktCrdtWireMessage =>
	JSON.parse(JSON.stringify(message)) as DktCrdtWireMessage;

const createPageBridgeCrdtTransport = (): MiniCutCrdtTransport => ({
	attach(
		crdtRuntime,
		context,
	): () => void {
		const listeners = new Set<(message: DktCrdtWireMessage) => void>();
		const transport: DktCrdtTransport = {
			send(message: DktCrdtWireMessage): void {
				context.sendToPage({
					type: DKT_MSG.CRDT_TRANSPORT_SEND,
					peerId: context.peerId,
					profileId: context.profileId,
					profileVersion: context.profileVersion,
					message: cloneWireMessage(message),
				});
			},
			subscribe(listener: (message: DktCrdtWireMessage) => void): () => void {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			close(): void {
				listeners.clear();
			},
		};
		const unsubscribePage = context.subscribePageCrdtMessages((message) => {
			const wireMessage = message as DktCrdtWireMessage;
			for (const listener of [...listeners]) {
				listener(cloneWireMessage(wireMessage));
			}
		});
		if (typeof crdtRuntime.attachTransport === "function") {
			crdtRuntime.attachTransport(transport, { baseModel: context.baseModel });
		}
		return () => {
			unsubscribePage();
			transport.close?.();
		};
	},
});

const isCrdtTestHarnessEnabled = (): boolean =>
	import.meta.env.VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS === "1" ||
	import.meta.env.VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS === "true";

export const createMiniCutDktWorkerModelRuntime = () => {
	const enableCrdtTestHarness = isCrdtTestHarnessEnabled();
	const runtime = createMiniCutDktRuntime({
		enabled: true,
		crdt: enableCrdtTestHarness
			? {
					enabled: true,
					peerIdForSession: (sessionKey, sessionId) =>
						`minicut-browser:${sessionKey}:${sessionId}`,
					transportForSession: () => createPageBridgeCrdtTransport(),
					defaultStorageDbNameForSessionKey: (sessionKey) =>
						createMiniCutWorkspaceDbName(
							createMiniCutHarnessWorkspaceId(sessionKey),
						),
					workspaceIdForSessionKey: (sessionKey) =>
						createMiniCutHarnessWorkspaceId(sessionKey),
				}
			: false,
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
