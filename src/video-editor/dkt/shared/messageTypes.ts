export const DKT_MSG = {
	BOOTSTRAP: 'dkt:bootstrap',
	CLOSE_SESSION: 'dkt:close-session',
	DISPATCH_ACTION: 'dkt:dispatch-action',
	EXPORT_REQUEST: 'dkt:export-request',
	IDLE: 'dkt:idle',
	P2P_SESSION_LOST: 'dkt:p2p-session-lost',
	RUNTIME_READY: 'dkt:runtime-ready',
	RUNTIME_ERROR: 'dkt:runtime-error',
	RUNTIME_LOG: 'dkt:runtime-log',
	WAIT_IDLE: 'dkt:wait-idle',
	SYNC_HANDLE: 'dkt:sync-handle',
	SYNC_UPDATE_STRUCTURE_USAGE: 'dkt:sync-update-structure-usage',
	SYNC_REQUIRE_SHAPE: 'dkt:sync-require-shape',
	// Debug-only: request/receive a full worker model state dump
	DEBUG_DUMP_REQUEST: 'dkt:debug-dump-request',
	DEBUG_DUMP_RESPONSE: 'dkt:debug-dump-response',
} as const

export type DktDispatchActionMessage = {
	type: typeof DKT_MSG.DISPATCH_ACTION
	requestId?: string
	actionName: string
	payload?: unknown
	scopeNodeId?: string | null
}

export type DktRuntimeReadyMessage = {
	type: typeof DKT_MSG.RUNTIME_READY
	requestId?: string
	sessionKey?: string
	rootNodeId?: string | null
}

export type DktRuntimeErrorMessage = {
	type: typeof DKT_MSG.RUNTIME_ERROR
	requestId?: string
	message: unknown
}

export type DktSyncHandleMessage = {
	type: typeof DKT_MSG.SYNC_HANDLE
	syncType: number
	payload: unknown
}

export type DktSyncUpdateStructureUsageMessage = {
	type: typeof DKT_MSG.SYNC_UPDATE_STRUCTURE_USAGE
	data: unknown
}

export type DktSyncRequireShapeMessage = {
	type: typeof DKT_MSG.SYNC_REQUIRE_SHAPE
	data: unknown
}

export type DktRuntimeLogMessage = {
	type: typeof DKT_MSG.RUNTIME_LOG
	message: unknown
}

export type DktExportRequestMessage = {
	type: typeof DKT_MSG.EXPORT_REQUEST
	payload: unknown
}

export type DktRuntimeIdleRequestMessage = {
	type: typeof DKT_MSG.WAIT_IDLE
	requestId?: string
}

export type DktRuntimeIdleResponseMessage = {
	type: typeof DKT_MSG.IDLE
	requestId?: string
}

export type DktP2PSessionLostMessage = {
	type: typeof DKT_MSG.P2P_SESSION_LOST
	reason: string
}

export type MiniCutDktTransportMessage =
	| { type: typeof DKT_MSG.BOOTSTRAP; sessionKey?: string; route?: unknown }
	| { type: typeof DKT_MSG.CLOSE_SESSION }
	| DktDispatchActionMessage
	| DktExportRequestMessage
	| DktP2PSessionLostMessage
	| DktRuntimeReadyMessage
	| DktRuntimeErrorMessage
	| DktRuntimeLogMessage
	| DktSyncHandleMessage
	| DktSyncUpdateStructureUsageMessage
	| DktSyncRequireShapeMessage
	| DktRuntimeIdleRequestMessage
	| DktRuntimeIdleResponseMessage
	| { type: typeof DKT_MSG.DEBUG_DUMP_REQUEST }
	| { type: typeof DKT_MSG.DEBUG_DUMP_RESPONSE; dump: unknown }

