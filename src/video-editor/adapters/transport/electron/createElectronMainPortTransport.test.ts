import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createFakeMainPort } from "../../../hosts/electron/testing/fakeElectron";
import { createElectronMainPortTransport } from "./createElectronMainPortTransport";

describe("createElectronMainPortTransport", () => {
	it("passes messages in both directions, including ones with a data field", async () => {
		const channel = new MessageChannel();
		const transport = createElectronMainPortTransport(createFakeMainPort(channel.port1));
		const outgoing = { type: "dkt:sync-update-structure-usage", data: { nodes: [1] } };

		const incoming = new Promise<unknown>((resolve) => {
			transport.listen((message) => resolve(message));
		});
		const received = new Promise((resolve) => channel.port2.once("message", resolve));
		channel.port2.postMessage(outgoing);
		transport.send({ type: "dkt:runtime-log", message: "hi" });

		expect(await incoming).toEqual(outgoing);
		expect(await received).toEqual({ type: "dkt:runtime-log", message: "hi" });
		transport.destroy();
		channel.port2.close();
	});

	it("reports the disconnect once when the renderer end closes", async () => {
		const channel = new MessageChannel();
		const transport = createElectronMainPortTransport(createFakeMainPort(channel.port1));
		const disconnected = new Promise<void>((resolve) => {
			transport.onDisconnect(resolve);
		});
		let calls = 0;
		transport.onDisconnect(() => {
			calls += 1;
		});

		channel.port2.close();
		await disconnected;

		expect(calls).toBe(1);
		transport.destroy();
	});

	it("stops sending and unsubscribes after destroy", () => {
		const channel = new MessageChannel();
		const transport = createElectronMainPortTransport(createFakeMainPort(channel.port1));
		const received: unknown[] = [];
		channel.port2.on("message", (message) => received.push(message));

		transport.destroy();
		transport.send({ type: "dkt:runtime-log", message: "late" });

		expect(received).toEqual([]);
		channel.port2.close();
	});
});
