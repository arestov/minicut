import type { ProductRoomProtocolMessage } from "../../worker/productRoomProtocol";

export const DKT_MSG = {
	BOOTSTRAP: "dkt:bootstrap",
	CLOSE_SESSION: "dkt:close-session",
	DISPATCH_ACTION: "dkt:dispatch-action",
	EXPORT_REQUEST: "dkt:export-request",
	IMPORT_FILES_REQUEST: "dkt:import-files-request",
	IDLE: "dkt:idle",
	P2P_SESSION_LOST: "dkt:p2p-session-lost",
	RUNTIME_READY: "dkt:runtime-ready",
	RUNTIME_ERROR: "dkt:runtime-error",
	RUNTIME_LOG: "dkt:runtime-log",
	WORKSPACE_OPEN_STATE: "dkt:workspace-open-state",
	WAIT_IDLE: "dkt:wait-idle",
	SYNC_HANDLE: "dkt:sync-handle",
	SYNC_UPDATE_STRUCTURE_USAGE: "dkt:sync-update-structure-usage",
	SYNC_REQUIRE_SHAPE: "dkt:sync-require-shape",
	// Debug-only: request/receive a full worker model state dump
	DEBUG_DUMP_REQUEST: "dkt:debug-dump-request",
	DEBUG_DUMP_RESPONSE: "dkt:debug-dump-response",
	CRDT_TRANSPORT_SEND: "dkt:crdt-transport-send",
	CRDT_TRANSPORT_RECEIVE: "dkt:crdt-transport-receive",
	PRODUCT_ROOM_MESSAGE: "dkt:product-room-message",
} as const;

export type DktDispatchActionMessage = {
	type: typeof DKT_MSG.DISPATCH_ACTION;
	requestId?: string;
	actionName: string;
	payload?: unknown;
	scopeNodeId?: string | null;
	meta?: unknown;
};

export type DktRuntimeReadyMessage = {
	type: typeof DKT_MSG.RUNTIME_READY;
	requestId?: string;
	sessionId?: string;
	sessionKey?: string;
	rootNodeId?: string | null;
};

export type DktRuntimeErrorMessage = {
	type: typeof DKT_MSG.RUNTIME_ERROR;
	requestId?: string;
	message: unknown;
};

export type DktWorkspaceOpenStateMessage = {
	type: typeof DKT_MSG.WORKSPACE_OPEN_STATE;
	state: {
		status: number;
		failureReason: number;
	};
	statusLabel?: string;
	failureReasonLabel?: string;
	message?: string;
};

export type DktSyncHandleMessage = {
	type: typeof DKT_MSG.SYNC_HANDLE;
	syncType: number;
	payload: unknown;
};

export type DktSyncUpdateStructureUsageMessage = {
	type: typeof DKT_MSG.SYNC_UPDATE_STRUCTURE_USAGE;
	data: unknown;
};

export type DktSyncRequireShapeMessage = {
	type: typeof DKT_MSG.SYNC_REQUIRE_SHAPE;
	data: unknown;
};

export type DktRuntimeLogMessage = {
	type: typeof DKT_MSG.RUNTIME_LOG;
	message: unknown;
};

export type DktExportRequestMessage = {
	type: typeof DKT_MSG.EXPORT_REQUEST;
	payload: unknown;
};

export type DktImportFilesRequestMessage = {
	type: typeof DKT_MSG.IMPORT_FILES_REQUEST;
	payload: unknown;
};

export type DktRuntimeIdleRequestMessage = {
	type: typeof DKT_MSG.WAIT_IDLE;
	requestId?: string;
};

export type DktRuntimeIdleResponseMessage = {
	type: typeof DKT_MSG.IDLE;
	requestId?: string;
};

export type DktP2PSessionLostMessage = {
	type: typeof DKT_MSG.P2P_SESSION_LOST;
	reason: string;
};

export type MiniCutDktTransportMessage =
	| {
			type: typeof DKT_MSG.BOOTSTRAP;
			sessionId?: string;
			sessionKey?: string;
			route?: unknown;
	  }
	| { type: typeof DKT_MSG.CLOSE_SESSION }
	| DktDispatchActionMessage
	| DktExportRequestMessage
	| DktImportFilesRequestMessage
	| DktP2PSessionLostMessage
	| DktRuntimeReadyMessage
	| DktRuntimeErrorMessage
	| DktWorkspaceOpenStateMessage
	| DktRuntimeLogMessage
	| DktSyncHandleMessage
	| DktSyncUpdateStructureUsageMessage
	| DktSyncRequireShapeMessage
	| DktRuntimeIdleRequestMessage
	| DktRuntimeIdleResponseMessage
	| { type: typeof DKT_MSG.DEBUG_DUMP_REQUEST }
	| { type: typeof DKT_MSG.DEBUG_DUMP_RESPONSE; dump: unknown }
	| {
			type: typeof DKT_MSG.CRDT_TRANSPORT_SEND;
			message: unknown;
			peerId?: string;
			profileId?: string;
			profileVersion?: number;
	  }
	| {
			type: typeof DKT_MSG.CRDT_TRANSPORT_RECEIVE;
			message: unknown;
	  }
	| {
			type: typeof DKT_MSG.PRODUCT_ROOM_MESSAGE;
			message: ProductRoomProtocolMessage;
	  };
