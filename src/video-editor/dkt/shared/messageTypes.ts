export const DKT_MSG = {
	BOOTSTRAP: 'dkt:bootstrap',
	CLOSE_SESSION: 'dkt:close-session',
	DISPATCH_ACTION: 'dkt:dispatch-action',
	DISPATCH_COMMAND: 'dkt:dispatch-command',
	GET_SNAPSHOT: 'dkt:get-snapshot',
	REPLACE_SNAPSHOT: 'dkt:replace-snapshot',
	RUNTIME_READY: 'dkt:runtime-ready',
	RUNTIME_ERROR: 'dkt:runtime-error',
	RUNTIME_LOG: 'dkt:runtime-log',
	SNAPSHOT: 'dkt:snapshot',
	DISPATCH_RESULT: 'dkt:dispatch-result',
	PATCHES: 'dkt:patches',
	SYNC_HANDLE: 'dkt:sync-handle',
	SYNC_UPDATE_STRUCTURE_USAGE: 'dkt:sync-update-structure-usage',
	SYNC_REQUIRE_SHAPE: 'dkt:sync-require-shape',
} as const

export type DktBootstrapMessage = {
	type: typeof DKT_MSG.BOOTSTRAP
	sessionKey?: string
	route?: unknown
}

export type DktCloseSessionMessage = {
	type: typeof DKT_MSG.CLOSE_SESSION
}

export type DktDispatchActionMessage = {
	type: typeof DKT_MSG.DISPATCH_ACTION
	requestId?: string
	actionName: string
	payload?: unknown
	scopeNodeId?: string | null
}

export type DktDispatchCommandMessage = {
	type: typeof DKT_MSG.DISPATCH_COMMAND
	requestId?: string
	command: unknown
}

export type DktGetSnapshotMessage = {
	type: typeof DKT_MSG.GET_SNAPSHOT
	requestId?: string
}

export type DktReplaceSnapshotMessage = {
	type: typeof DKT_MSG.REPLACE_SNAPSHOT
	requestId?: string
	snapshot: unknown
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

export type DktRuntimeLogMessage = {
	type: typeof DKT_MSG.RUNTIME_LOG
	message: string
}

export type DktSnapshotMessage = {
	type: typeof DKT_MSG.SNAPSHOT
	requestId?: string
	snapshot: unknown
}

export type DktDispatchResultMessage = {
	type: typeof DKT_MSG.DISPATCH_RESULT
	requestId?: string
	result: unknown
}

export type DktPatchesMessage = {
	type: typeof DKT_MSG.PATCHES
	envelope: unknown
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

export type MiniCutDktTransportMessage =
	| DktBootstrapMessage
	| DktCloseSessionMessage
	| DktDispatchActionMessage
	| DktDispatchCommandMessage
	| DktGetSnapshotMessage
	| DktReplaceSnapshotMessage
	| DktRuntimeReadyMessage
	| DktRuntimeErrorMessage
	| DktRuntimeLogMessage
	| DktSnapshotMessage
	| DktDispatchResultMessage
	| DktPatchesMessage
	| DktSyncHandleMessage
	| DktSyncUpdateStructureUsageMessage
	| DktSyncRequireShapeMessage

export const DKT_LEGACY_REGISTRY_MSG_TYPES = new Set<string>([
	DKT_MSG.DISPATCH_COMMAND,
	DKT_MSG.REPLACE_SNAPSHOT,
	DKT_MSG.SNAPSHOT,
	DKT_MSG.PATCHES,
])

export const isLegacyDktRegistryMessage = (message: MiniCutDktTransportMessage): boolean =>
	DKT_LEGACY_REGISTRY_MSG_TYPES.has(message.type)
