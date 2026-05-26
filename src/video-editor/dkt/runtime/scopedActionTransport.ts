import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";

export const createBootstrapMessage = (options?: {
	sessionId?: string | null;
	sessionKey?: string | null;
	route?: unknown;
}): MiniCutDktTransportMessage => ({
	type: DKT_MSG.BOOTSTRAP,
	...(options?.sessionId ? { sessionId: options.sessionId } : {}),
	...(options?.sessionKey ? { sessionKey: options.sessionKey } : {}),
	...(options && "route" in options ? { route: options.route } : {}),
});

export const createCloseSessionMessage = (): MiniCutDktTransportMessage => ({
	type: DKT_MSG.CLOSE_SESSION,
});

export const createDispatchActionMessage = (
	actionName: string,
	payload?: unknown,
	scopeNodeId?: string | null,
	meta?: unknown,
): MiniCutDktTransportMessage => ({
	type: DKT_MSG.DISPATCH_ACTION,
	actionName,
	payload,
	scopeNodeId: scopeNodeId ?? null,
	...(meta === undefined ? {} : { meta }),
});

export const createSyncUpdateStructureUsageMessage = (
	data: unknown,
): MiniCutDktTransportMessage => ({
	type: DKT_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
	data,
});

export const createSyncRequireShapeMessage = (
	data: unknown,
): MiniCutDktTransportMessage => ({
	type: DKT_MSG.SYNC_REQUIRE_SHAPE,
	data,
});
