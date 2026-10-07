import { EventEmitter } from "node:events";
import type { MessagePort } from "node:worker_threads";
import type { IpcMainEvent } from "electron";
import { createPortTransport } from "../../../dkt/shared/createPortTransport";
import type { MiniCutDktTransportMessage } from "../../../dkt/shared/messageTypes";
import type { DesktopHandshakeReply } from "../shared/ipcChannels";

export const TRUSTED_TEST_URL = "minicut-test://renderer/index.html";

export type Posted = { channel: string; reply: DesktopHandshakeReply; ports: unknown[] };

export const createFakeIpc = () => {
	const listeners = new Map<string, Set<(event: IpcMainEvent) => void>>();
	return {
		on(channel: string, listener: (event: IpcMainEvent) => void) {
			const set = listeners.get(channel) ?? new Set();
			set.add(listener);
			listeners.set(channel, set);
		},
		removeListener(channel: string, listener: (event: IpcMainEvent) => void) {
			listeners.get(channel)?.delete(listener);
		},
		listenerCount: (channel: string) => listeners.get(channel)?.size ?? 0,
		emit(channel: string, event: unknown, ...args: unknown[]) {
			for (const listener of [...(listeners.get(channel) ?? [])]) {
				(listener as (event: IpcMainEvent, ...args: unknown[]) => void)(
					event as IpcMainEvent,
					...args,
				);
			}
		},
	};
};

export const createFakeWindow = (id: number, url = TRUSTED_TEST_URL) => {
	const posted: Posted[] = [];
	const mainFrame = { url };
	const emitter = new EventEmitter();
	const sender = Object.assign(emitter, {
		id,
		mainFrame,
		postMessage(channel: string, reply: DesktopHandshakeReply, ports: unknown[]) {
			posted.push({ channel, reply, ports });
		},
	});
	return {
		posted,
		sender,
		event: (frame: unknown = mainFrame) => ({
			sender,
			senderFrame: frame,
			returnValue: undefined as unknown,
		}),
	};
};

/** Renderer-side view of a window channel: collects replies, waits by predicate. */
export const openRendererEnd = (port: MessagePort) => {
	const transport = createPortTransport<MiniCutDktTransportMessage>(port as never);
	const received: MiniCutDktTransportMessage[] = [];
	const waiters = new Set<{
		predicate: (message: MiniCutDktTransportMessage) => boolean;
		resolve: (message: MiniCutDktTransportMessage) => void;
	}>();
	transport.listen((message) => {
		received.push(message);
		for (const waiter of [...waiters]) {
			if (waiter.predicate(message)) {
				waiters.delete(waiter);
				waiter.resolve(message);
			}
		}
	});
	const waitFor = (predicate: (message: MiniCutDktTransportMessage) => boolean) =>
		new Promise<MiniCutDktTransportMessage>((resolve) => {
			const existing = received.find(predicate);
			if (existing) {
				resolve(existing);
				return;
			}
			waiters.add({ predicate, resolve });
		});
	return { transport, received, waitFor };
};

