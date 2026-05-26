import type { ProductRoomProtocolMessage } from "../../worker/productRoomProtocol";

export const DKT_MSG = {
	BOOTSTRAP: "dkt:bootstrap",
	CLOSE_SESSION: "dkt:close-session",
	ACTION_ACCEPTED: "dkt:action-accepted",
	DISPATCH_ACTION: "dkt:dispatch-action",
	EXPORT_REQUEST: "dkt:export-request",
	IMPORT_FILES_REQUEST: "dkt:import-files-request",
	P2P_SESSION_LOST: "dkt:p2p-session-lost",
	RUNTIME_READY: "dkt:runtime-ready",
	RUNTIME_ERROR: "dkt:runtime-error",
	RUNTIME_LOG: "dkt:runtime-log",
	WORKSPACE_OPEN_STATE: "dkt:workspace-open-state",
	SYNC_HANDLE: "dkt:sync-handle",
	SYNC_UPDATE_STRUCTURE_USAGE: "dkt:sync-update-structure-usage",
	SYNC_REQUIRE_SHAPE: "dkt:sync-require-shape",
	CRDT_TRANSPORT_SEND: "dkt:crdt-transport-send",
	CRDT_TRANSPORT_RECEIVE: "dkt:crdt-transport-receive",
	PRODUCT_ROOM_MESSAGE: "dkt:product-room-message",
} as const;

export const DKT_TEST_MSG = {
	WAIT_IDLE: "test:dkt:wait-idle",
	IDLE: "test:dkt:idle",
	ERROR: "test:dkt:error",
	DEBUG_DUMP_REQUEST: "test:dkt:debug-dump-request",
	DEBUG_DUMP_RESPONSE: "test:dkt:debug-dump-response",
	DISPATCH_ACTION_AND_SETTLE: "test:dkt:dispatch-action-and-settle",
	READ_PROJECT_STATE: "test:dkt:read-project-state",
} as const;

export type DktDispatchActionMessage = {
	type: typeof DKT_MSG.DISPATCH_ACTION;
	requestId?: string;
	actionName: string;
	payload?: unknown;
	scopeNodeId?: string | null;
	meta?: unknown;
};

export type DktActionAcceptedMessage = {
	type: typeof DKT_MSG.ACTION_ACCEPTED;
	requestId?: string;
	actionName: string;
	sessionId?: string;
	sessionKey?: string;
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

export type DktP2PSessionLostMessage = {
	type: typeof DKT_MSG.P2P_SESSION_LOST;
	reason: string;
};

export type MiniCutDktTestTransportMessage =
	| { type: typeof DKT_TEST_MSG.WAIT_IDLE; requestId: string }
	| { type: typeof DKT_TEST_MSG.IDLE; requestId: string }
	| {
			type: typeof DKT_TEST_MSG.ERROR;
			requestId?: string;
			phase?: string;
			error: { name?: string; message: string; stack?: string };
	  }
	| { type: typeof DKT_TEST_MSG.DEBUG_DUMP_REQUEST; requestId?: string }
	| {
			type: typeof DKT_TEST_MSG.DEBUG_DUMP_RESPONSE;
			requestId?: string;
			dump: unknown;
	  }
	| {
			type: typeof DKT_TEST_MSG.DISPATCH_ACTION_AND_SETTLE;
			requestId: string;
			actionName: string;
			payload?: unknown;
			scopeNodeId?: string | null;
			sessionKey?: string;
			sessionId?: string | null;
			meta?: unknown;
	  }
	| { type: typeof DKT_TEST_MSG.READ_PROJECT_STATE; requestId?: string };

export type MiniCutDktTransportMessage =
	| {
			type: typeof DKT_MSG.BOOTSTRAP;
			sessionId?: string;
			sessionKey?: string;
			route?: unknown;
	  }
	| { type: typeof DKT_MSG.CLOSE_SESSION }
	| DktActionAcceptedMessage
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
	  }
	| MiniCutDktTestTransportMessage;
