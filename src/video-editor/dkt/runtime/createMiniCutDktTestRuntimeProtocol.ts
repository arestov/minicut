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

const serializeError = (
	error: unknown,
): { name?: string; message: string; stack?: string } => {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	if (error && typeof error === "object") {
		const record = error as { name?: unknown; message?: unknown; stack?: unknown };
		if (typeof record.message === "string") {
			return {
				name: typeof record.name === "string" ? record.name : undefined,
				message: record.message,
				stack: typeof record.stack === "string" ? record.stack : undefined,
			};
		}
	}
	return { message: String(error) };
};

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
		return record;
	}
	return {
		...(workerState as Record<string, unknown>),
		...record,
	};
};

const sendTestProtocolError = (
	transport: DomSyncTransportLike<MiniCutDktTransportMessage>,
	requestId: string | undefined,
	phase: string,
	error: unknown,
): void => {
	const message: MiniCutDktTransportMessage = {
		type: DKT_TEST_MSG.ERROR,
		requestId,
		phase,
		error: serializeError(error),
	};
	try {
		transport.send(message);
	} catch (sendError) {
		console.error("[minicut:dkt-test-protocol:send-error]", sendError);
	}
};

const replyOrReport = (
	transport: DomSyncTransportLike<MiniCutDktTransportMessage>,
	requestId: string | undefined,
	phase: string,
	makeMessage: () => MiniCutDktTransportMessage,
): void => {
	try {
		transport.send(makeMessage());
	} catch (error) {
		sendTestProtocolError(transport, requestId, phase, error);
	}
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
				try {
					const app = await deps.bootstrapApp(
						context.activeSessionKey,
						context.activeSessionId,
					);
					await waitForRuntimeIdle(app);
					replyOrReport(
						transport,
						message.requestId,
						"wait-idle",
						() => ({ type: DKT_TEST_MSG.IDLE, requestId: message.requestId }),
					);
				} catch (error) {
					sendTestProtocolError(
						transport,
						message.requestId,
						"wait-idle",
						error,
					);
				}
				return true;
			}
			case DKT_TEST_MSG.DISPATCH_ACTION_AND_SETTLE: {
				try {
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
					replyOrReport(
						transport,
						message.requestId,
						"dispatch-action-and-settle",
						() => ({ type: DKT_TEST_MSG.IDLE, requestId: message.requestId }),
					);
				} catch (error) {
					sendTestProtocolError(
						transport,
						message.requestId,
						"dispatch-action-and-settle",
						error,
					);
				}
				return true;
			}
			case DKT_TEST_MSG.DEBUG_DUMP_REQUEST: {
				try {
					const dump = normalizeDebugDumpForTests(
						await deps.debugDumpState(context.activeSessionKey),
					);
					replyOrReport(
						transport,
						message.requestId,
						"debug-dump",
						() => ({
							type: DKT_TEST_MSG.DEBUG_DUMP_RESPONSE,
							requestId: message.requestId,
							dump,
						}),
					);
				} catch (error) {
					sendTestProtocolError(
						transport,
						message.requestId,
						"debug-dump",
						error,
					);
				}
				return true;
			}
			case DKT_TEST_MSG.READ_PROJECT_STATE:
			case DKT_TEST_MSG.IDLE:
			case DKT_TEST_MSG.ERROR:
			case DKT_TEST_MSG.DEBUG_DUMP_RESPONSE:
				return false;
		}
	},
});
