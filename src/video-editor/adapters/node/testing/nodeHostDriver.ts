import { DKT_MSG, DKT_TEST_MSG, type MiniCutDktTransportMessage } from "../../../dkt/shared/messageTypes";
import type { NodeMiniCutHost } from "../startNodeMiniCutHost";

type Waiter = {
	predicate: (message: MiniCutDktTransportMessage) => boolean;
	resolve: (message: MiniCutDktTransportMessage) => void;
};

export type NodeHostTestDump = {
	booted?: boolean;
	runtimeError?: string | null;
	crdt?: {
		enabled?: boolean;
		peerId?: string;
		outboxCount?: number;
		durableLogCount?: number;
		transportTrace?: unknown[];
		hasRegistry?: boolean;
	};
	runtimeModels?: {
		nodeId: string | null;
		modelName: string | null;
		attrs: Record<string, unknown>;
	}[];
};

/**
 * Drives a Node host through the same message protocol a window uses.
 * Mutations (`dispatchAndSettle`) and reads (`readDump`) are separate steps.
 * Replies are awaited through the transport `send` callback, not by polling.
 */
export const connectNodeHostTestWindow = (
	host: Pick<NodeMiniCutHost, "runtime">,
	sessionKey = "test-window",
) => {
	const sent: MiniCutDktTransportMessage[] = [];
	const waiters = new Set<Waiter>();
	let listener: ((message: MiniCutDktTransportMessage) => void) | null = null;
	let counter = 0;

	const connection = host.runtime.connect({
		send(message: MiniCutDktTransportMessage) {
			sent.push(message);
			for (const waiter of [...waiters]) {
				if (waiter.predicate(message)) {
					waiters.delete(waiter);
					waiter.resolve(message);
				}
			}
		},
		listen(next: (message: MiniCutDktTransportMessage) => void) {
			listener = next;
			return () => {
				listener = null;
			};
		},
		destroy() {},
	});

	const waitFor = (
		predicate: Waiter["predicate"],
	): Promise<MiniCutDktTransportMessage> =>
		new Promise((resolve) => {
			const existing = sent.find(predicate);
			if (existing) {
				resolve(existing);
				return;
			}
			waiters.add({ predicate, resolve });
		});

	const request = async (
		message: MiniCutDktTransportMessage,
		isReply: (reply: MiniCutDktTransportMessage, requestId: string) => boolean,
	) => {
		counter += 1;
		const requestId = `req-${counter}`;
		const reply = waitFor((candidate) => isReply(candidate, requestId));
		listener?.({ ...message, requestId } as MiniCutDktTransportMessage);
		return reply;
	};

	const failOn = (reply: MiniCutDktTransportMessage) => {
		if (
			reply.type === DKT_TEST_MSG.ERROR ||
			reply.type === DKT_MSG.RUNTIME_ERROR
		) {
			throw new Error(
				`Node host test window error: ${JSON.stringify(reply)}`,
			);
		}
	};

	const isReplyTo =
		(...types: string[]) =>
		(reply: MiniCutDktTransportMessage, requestId: string) =>
			(reply as { requestId?: string }).requestId === requestId &&
			(types.includes(reply.type) ||
				reply.type === DKT_TEST_MSG.ERROR ||
				reply.type === DKT_MSG.RUNTIME_ERROR);

	return {
		sent,
		connection,
		async bootstrap(): Promise<void> {
			const ready = waitFor(
				(message) =>
					message.type === DKT_MSG.RUNTIME_READY ||
					message.type === DKT_MSG.RUNTIME_ERROR,
			);
			listener?.({ type: DKT_MSG.BOOTSTRAP, sessionKey, sessionId: sessionKey });
			failOn(await ready);
		},
		async dispatchAndSettle(
			actionName: string,
			payload?: unknown,
			scopeNodeId?: string | null,
		): Promise<void> {
			const reply = await request(
				{
					type: DKT_TEST_MSG.DISPATCH_ACTION_AND_SETTLE,
					requestId: "",
					actionName,
					payload,
					scopeNodeId,
				},
				isReplyTo(DKT_TEST_MSG.IDLE),
			);
			failOn(reply);
		},
		async readDump(): Promise<NodeHostTestDump> {
			const reply = await request(
				{ type: DKT_TEST_MSG.DEBUG_DUMP_REQUEST },
				isReplyTo(DKT_TEST_MSG.DEBUG_DUMP_RESPONSE),
			);
			failOn(reply);
			return (reply as { dump: NodeHostTestDump }).dump;
		},
	};
};

export const findModels = (dump: NodeHostTestDump, modelName: string) =>
	(dump.runtimeModels ?? []).filter((model) => model.modelName === modelName);
