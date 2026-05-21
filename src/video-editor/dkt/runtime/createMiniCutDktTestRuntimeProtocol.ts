import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import {
	DKT_TEST_MSG,
	type MiniCutDktTestTransportMessage,
	type MiniCutDktTransportMessage,
} from "../shared/messageTypes";

type RuntimeModelLike = {
	input?: (callback: () => void | Promise<void>) => unknown;
};

type RuntimeLike = {
	whenAllReady?: (fn: () => void) => void;
};

type BootstrappedApp = {
	runtime: RuntimeLike;
	appModel: RuntimeModelLike;
};

type TestRuntimeProtocolDeps = {
	bootstrapApp: (
		sessionKey?: string,
		sessionId?: string | null,
	) => Promise<BootstrappedApp | null>;
	enqueueScopedAction: (
		actionName: string,
		payload?: unknown,
		scopeNodeId?: string | null,
		sessionKey?: string,
		sessionId?: string | null,
		meta?: unknown,
	) => Promise<void>;
	debugDumpState: (sessionKey?: string) => Promise<unknown>;
};

type TestRuntimeProtocolContext = {
	activeSessionKey: string;
	activeSessionId: string;
};

const testMessageTypes = new Set<string>(Object.values(DKT_TEST_MSG));

const waitForRuntimeIdle = async (
	app: BootstrappedApp | null,
): Promise<void> => {
	if (!app) {
		return;
	}

	await new Promise<void>((resolve) => {
		if (typeof app.appModel.input === "function") {
			app.appModel.input(() => resolve());
			return;
		}

		if (typeof app.runtime.whenAllReady === "function") {
			app.runtime.whenAllReady(() => resolve());
			return;
		}

		resolve();
	});
};

const normalizeDebugDumpForTests = (dump: unknown): unknown => {
	if (!dump || typeof dump !== "object") {
		return dump;
	}
	const record = dump as Record<string, unknown>;
	const workerState = record.workerState;
	if (!workerState || typeof workerState !== "object") {
		return dump;
	}
	return {
		...(workerState as Record<string, unknown>),
		...record,
	};
};

export const createMiniCutDktTestRuntimeProtocol = (
	deps: TestRuntimeProtocolDeps,
) => ({
	canHandle(message: unknown): message is MiniCutDktTestTransportMessage {
		return Boolean(
			message &&
				typeof message === "object" &&
				"type" in message &&
				testMessageTypes.has(String((message as { type?: unknown }).type)),
		);
	},

	async handle(
		message: MiniCutDktTestTransportMessage,
		transport: DomSyncTransportLike<MiniCutDktTransportMessage>,
		context: TestRuntimeProtocolContext,
	): Promise<boolean> {
		switch (message.type) {
			case DKT_TEST_MSG.WAIT_IDLE: {
				const app = await deps.bootstrapApp(
					context.activeSessionKey,
					context.activeSessionId,
				);
				await waitForRuntimeIdle(app);
				transport.send({ type: DKT_TEST_MSG.IDLE, requestId: message.requestId });
				return true;
			}
			case DKT_TEST_MSG.DISPATCH_ACTION_AND_SETTLE: {
				const sessionKey = message.sessionKey ?? context.activeSessionKey;
				const sessionId = message.sessionId ?? context.activeSessionId;
				await deps.enqueueScopedAction(
					message.actionName,
					message.payload,
					message.scopeNodeId,
					sessionKey,
					sessionId,
					message.meta,
				);
				const app = await deps.bootstrapApp(sessionKey, sessionId);
				await waitForRuntimeIdle(app);
				transport.send({ type: DKT_TEST_MSG.IDLE, requestId: message.requestId });
				return true;
			}
			case DKT_TEST_MSG.DEBUG_DUMP_REQUEST: {
				transport.send({
					type: DKT_TEST_MSG.DEBUG_DUMP_RESPONSE,
					requestId: message.requestId,
					dump: normalizeDebugDumpForTests(
						await deps.debugDumpState(context.activeSessionKey),
					),
				});
				return true;
			}
			case DKT_TEST_MSG.READ_PROJECT_STATE:
			case DKT_TEST_MSG.IDLE:
			case DKT_TEST_MSG.DEBUG_DUMP_RESPONSE:
				return false;
		}
	},
});
