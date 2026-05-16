import type { MiniCutCrdtPacket } from "../../crdt/testRelayContracts";

export type MiniCutPeerId = "A" | "B" | "C";

export type MiniCutNetworkMessage = {
	from: MiniCutPeerId;
	to: MiniCutPeerId;
	packet: MiniCutCrdtPacket;
};

const clonePacket = (packet: MiniCutCrdtPacket): MiniCutCrdtPacket => ({
	...packet,
	ops: packet.ops?.map((op) =>
		op && typeof op === "object" ? { ...(op as Record<string, unknown>) } : op,
	),
});

const pairKey = (left: MiniCutPeerId, right: MiniCutPeerId): string =>
	[left, right].sort().join(":" );

const seededRank = (message: MiniCutNetworkMessage, seed: number): number => {
	const text = `${seed}:${message.from}:${message.to}:${JSON.stringify(
		message.packet.ops ?? [],
	)}`;
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
};

export class DeterministicMiniCutNetwork {
	private readonly peers = new Map<
		MiniCutPeerId,
		(message: MiniCutNetworkMessage) => Promise<void>
	>();
	private readonly blockedPairs = new Set<string>();
	private readonly pendingMessages: MiniCutNetworkMessage[] = [];
	private readonly deliveredMessages: MiniCutNetworkMessage[] = [];

	registerPeer(
		peerId: MiniCutPeerId,
		receive: (message: MiniCutNetworkMessage) => Promise<void>,
	): void {
		this.peers.set(peerId, receive);
	}

	partition(groupA: MiniCutPeerId[], groupB: MiniCutPeerId[]): void {
		for (const left of groupA) {
			for (const right of groupB) {
				this.blockedPairs.add(pairKey(left, right));
			}
		}
	}

	heal(): void {
		this.blockedPairs.clear();
	}

	enqueue(from: MiniCutPeerId, packet: MiniCutCrdtPacket): void {
		for (const to of this.peers.keys()) {
			if (to === from) continue;
			this.pendingMessages.push({ from, to, packet: clonePacket(packet) });
		}
	}

	pending(): MiniCutNetworkMessage[] {
		return this.pendingMessages.map((message) => ({
			...message,
			packet: clonePacket(message.packet),
		}));
	}

	delivered(): MiniCutNetworkMessage[] {
		return this.deliveredMessages.map((message) => ({
			...message,
			packet: clonePacket(message.packet),
		}));
	}

	async deliverAll(options: { duplicate?: boolean; reorder?: boolean; seed?: number } = {}): Promise<MiniCutNetworkMessage[]> {
		const deliverable: MiniCutNetworkMessage[] = [];
		const stillPending: MiniCutNetworkMessage[] = [];
		for (const message of this.pendingMessages) {
			if (this.blockedPairs.has(pairKey(message.from, message.to))) {
				stillPending.push(message);
			} else {
				deliverable.push(message);
				if (options.duplicate) {
					deliverable.push({ ...message, packet: clonePacket(message.packet) });
				}
			}
		}
		this.pendingMessages.splice(0, this.pendingMessages.length, ...stillPending);

		if (options.reorder) {
			const seed = options.seed ?? 1;
			deliverable.sort((left, right) => seededRank(left, seed) - seededRank(right, seed));
		}

		for (const message of deliverable) {
			const receive = this.peers.get(message.to);
			if (!receive) {
				throw new Error(`MiniCut maelstrom peer is not registered: ${message.to}`);
			}
			await receive({ ...message, packet: clonePacket(message.packet) });
			this.deliveredMessages.push({ ...message, packet: clonePacket(message.packet) });
		}

		return deliverable.map((message) => ({ ...message, packet: clonePacket(message.packet) }));
	}

	async replayDelivered(count = 1): Promise<void> {
		const replay = this.deliveredMessages.slice(-count);
		for (const message of replay) {
			const receive = this.peers.get(message.to);
			if (receive) {
				await receive({ ...message, packet: clonePacket(message.packet) });
			}
		}
	}
}