export const DKT_MSG = {
	BOOTSTRAP: 'dkt:bootstrap',
	DISPATCH_ACTION: 'dkt:dispatch-action',
	RUNTIME_READY: 'dkt:runtime-ready',
	RUNTIME_ERROR: 'dkt:runtime-error',
	RUNTIME_LOG: 'dkt:runtime-log',
} as const

export type DktBootstrapMessage = {
	type: typeof DKT_MSG.BOOTSTRAP
}

export type DktDispatchActionMessage = {
	type: typeof DKT_MSG.DISPATCH_ACTION
	actionName: string
	payload?: unknown
	scopeNodeId?: string | null
}

export type DktRuntimeReadyMessage = {
	type: typeof DKT_MSG.RUNTIME_READY
	rootNodeId?: string | null
}

export type DktRuntimeErrorMessage = {
	type: typeof DKT_MSG.RUNTIME_ERROR
	message: unknown
}

export type DktRuntimeLogMessage = {
	type: typeof DKT_MSG.RUNTIME_LOG
	message: string
}

export type MiniCutDktTransportMessage =
	| DktBootstrapMessage
	| DktDispatchActionMessage
	| DktRuntimeReadyMessage
	| DktRuntimeErrorMessage
	| DktRuntimeLogMessage
