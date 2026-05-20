import {
	WORKSPACE_OPEN_STATUS,
	type WorkspaceOpenState,
} from "../dkt/runtime/workspaceOpenState";
import {
	PRODUCT_ROOM_MSG,
	PRODUCT_ROOM_TRANSPORT_ERROR,
	WEBRTC_OWNER_STATUS,
	type ProductRoomCrdtReceive,
	type ProductRoomCrdtSend,
	type ProductRoomCrdtSendResult,
	type ProductRoomCrdtPacketHandler,
	type ProductRoomCrdtPeerAttached,
	type ProductRoomCrdtPeerDetached,
	type ProductRoomCrdtPeerHandler,
	type ProductRoomAttachWebRtc,
	type ProductRoomDetachWebRtc,
	type ProductRoomMediaPacketHandler,
	type ProductRoomMediaReceive,
	type ProductRoomMediaSend,
	type ProductRoomProtocolMessage,
	type ProductRoomTabHello,
	type ProductRoomTransportMessageResult,
	type ProductRoomWebRtcStatus,
} from "./productRoomProtocol";

type ProductRoomTransportOwnerTab = {
	hello: ProductRoomTabHello;
	send(message: ProductRoomProtocolMessage): void;
};

type ProductRoomTransportOwnerOptions = {
	roomId: string;
	heartbeatTimeoutMs?: number;
	now?: () => number;
	onCrdtPacket?: ProductRoomCrdtPacketHandler;
	onCrdtPeerAttached?: ProductRoomCrdtPeerHandler;
	onCrdtPeerDetached?: ProductRoomCrdtPeerHandler;
	onMediaPacket?: ProductRoomMediaPacketHandler;
};

type OwnerLease = {
	tabId: string;
	transportGeneration: number;
	lastHeartbeatAt: number;
	attached: boolean;
};

type PendingCrdtPacket = {
	packet: unknown;
	targetPeerId?: string;
};

type PendingMediaPacket = {
	envelope: unknown;
	targetPeerId?: string;
};

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;

const canAttachForWorkspace = (state: WorkspaceOpenState | null): boolean =>
	state?.status === WORKSPACE_OPEN_STATUS.READY ||
	state?.status === WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED;

export const createProductRoomTransportOwner = ({
	roomId,
	heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
	now = () => Date.now(),
	onCrdtPacket,
	onCrdtPeerAttached,
	onCrdtPeerDetached,
	onMediaPacket,
}: ProductRoomTransportOwnerOptions) => {
	const tabs = new Map<string, ProductRoomTransportOwnerTab>();
	const disabledOwnerTabs = new Set<string>();
	let transportGeneration = 0;
	let workspaceOpenState: WorkspaceOpenState | null = null;
	let ownerLease: OwnerLease | null = null;
	const pendingCrdtPackets: PendingCrdtPacket[] = [];
	const pendingMediaPackets: PendingMediaPacket[] = [];

	const sendCrdtPacketToOwner = (
		lease: OwnerLease,
		packet: unknown,
		targetPeerId?: string,
	): boolean => {
		const ownerTab = tabs.get(lease.tabId);
		if (!ownerTab) {
			return false;
		}
		ownerTab.send({
			type: PRODUCT_ROOM_MSG.CRDT_SEND,
			roomId,
			transportGeneration: lease.transportGeneration,
			packet,
			targetPeerId,
		} satisfies ProductRoomCrdtSend);
		return true;
	};

	const sendMediaPacketToOwner = (
		lease: OwnerLease,
		envelope: unknown,
		targetPeerId?: string,
	): boolean => {
		const ownerTab = tabs.get(lease.tabId);
		if (!ownerTab) {
			return false;
		}
		ownerTab.send({
			type: PRODUCT_ROOM_MSG.MEDIA_SEND,
			roomId,
			transportGeneration: lease.transportGeneration,
			envelope,
			targetPeerId,
		} satisfies ProductRoomMediaSend);
		return true;
	};

	const flushPendingPackets = (): void => {
		if (!ownerLease?.attached) {
			return;
		}
		while (pendingCrdtPackets.length > 0) {
			const pending = pendingCrdtPackets.shift();
			if (!pending || !sendCrdtPacketToOwner(ownerLease, pending.packet, pending.targetPeerId)) {
				return;
			}
		}
		while (pendingMediaPackets.length > 0) {
			const pending = pendingMediaPackets.shift();
			if (!pending || !sendMediaPacketToOwner(ownerLease, pending.envelope, pending.targetPeerId)) {
				return;
			}
		}
	};

	const sendDetach = (lease: OwnerLease): void => {
		const ownerTab = tabs.get(lease.tabId);
		if (!ownerTab) {
			return;
		}
		ownerTab.send({
			type: PRODUCT_ROOM_MSG.DETACH_WEBRTC,
			roomId,
			transportGeneration: lease.transportGeneration,
		} satisfies ProductRoomDetachWebRtc);
	};

	const detachOwner = (notifyOwner: boolean): void => {
		const lease = ownerLease;
		ownerLease = null;
		if (lease && notifyOwner) {
			sendDetach(lease);
		}
	};

	const electOwner = (): void => {
		if (ownerLease || !canAttachForWorkspace(workspaceOpenState)) {
			return;
		}

		for (const [tabId, tab] of tabs) {
			if (
				tab.hello.roomId !== roomId ||
				!tab.hello.canHostWebRtc ||
				disabledOwnerTabs.has(tabId)
			) {
				continue;
			}

			const lease = {
				tabId,
				transportGeneration: ++transportGeneration,
				lastHeartbeatAt: now(),
				attached: false,
			};
			ownerLease = lease;
			tab.send({
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId,
				transportGeneration: lease.transportGeneration,
			} satisfies ProductRoomAttachWebRtc);
			return;
		}
	};

	const setWorkspaceOpenState = (state: WorkspaceOpenState): void => {
		workspaceOpenState = state;
		if (state.status === WORKSPACE_OPEN_STATUS.FAILED) {
			detachOwner(true);
			return;
		}
		electOwner();
	};

	const registerTab = (
		hello: ProductRoomTabHello,
		send: ProductRoomTransportOwnerTab["send"],
	): void => {
		if (hello.roomId !== roomId) {
			return;
		}
		tabs.set(hello.tabId, { hello, send });
		if (hello.canHostWebRtc) {
			disabledOwnerTabs.delete(hello.tabId);
		}
		electOwner();
	};

	const unregisterTab = (tabId: string): void => {
		tabs.delete(tabId);
		disabledOwnerTabs.delete(tabId);
		if (ownerLease?.tabId === tabId) {
			detachOwner(false);
			electOwner();
		}
	};

	const acceptsOwnerMessage = ({
		tabId,
		roomId: messageRoomId,
		transportGeneration: messageGeneration,
	}: {
		tabId: string;
		roomId: string;
		transportGeneration: number;
	}): ProductRoomTransportMessageResult => {
		if (messageRoomId !== roomId) {
			return { ok: false, errorCode: PRODUCT_ROOM_TRANSPORT_ERROR.ROOM_MISMATCH };
		}
		if (!ownerLease || ownerLease.tabId !== tabId) {
			return { ok: false, errorCode: PRODUCT_ROOM_TRANSPORT_ERROR.TAB_NOT_OWNER };
		}
		if (ownerLease.transportGeneration !== messageGeneration) {
			return { ok: false, errorCode: PRODUCT_ROOM_TRANSPORT_ERROR.STALE_GENERATION };
		}
		return { ok: true };
	};

	const handleOwnerHeartbeat = (message: {
		tabId: string;
		roomId: string;
		transportGeneration: number;
	}): ProductRoomTransportMessageResult => {
		const accepted = acceptsOwnerMessage(message);
		if (!accepted.ok) {
			return accepted;
		}
		ownerLease.lastHeartbeatAt = now();
		return { ok: true };
	};

	const handleOwnerStatus = (message: ProductRoomWebRtcStatus): ProductRoomTransportMessageResult => {
		const accepted = acceptsOwnerMessage(message);
		if (
			!accepted.ok &&
			accepted.errorCode === PRODUCT_ROOM_TRANSPORT_ERROR.ROOM_MISMATCH
		) {
			return accepted;
		}
		if (!accepted.ok) {
			return accepted;
		}
		if (message.status === WEBRTC_OWNER_STATUS.ATTACHED) {
			ownerLease.lastHeartbeatAt = now();
			ownerLease.attached = true;
			flushPendingPackets();
			return { ok: true };
		}
		if (message.status === WEBRTC_OWNER_STATUS.REJECTED_ROOM_MISMATCH) {
			disabledOwnerTabs.add(message.tabId);
		}
		detachOwner(message.status !== WEBRTC_OWNER_STATUS.CLOSED);
		electOwner();
		return { ok: true };
	};

	const handleCrdtPeerAttached = (
		message: ProductRoomCrdtPeerAttached & { tabId: string },
	): ProductRoomTransportMessageResult => {
		const accepted = acceptsOwnerMessage(message);
		if (!accepted.ok) {
			return accepted;
		}
		onCrdtPeerAttached?.({
			peerId: message.peerId,
			transportGeneration: message.transportGeneration,
			roomId: message.roomId,
		});
		return { ok: true };
	};

	const handleCrdtPeerDetached = (
		message: ProductRoomCrdtPeerDetached & { tabId: string },
	): ProductRoomTransportMessageResult => {
		const accepted = acceptsOwnerMessage(message);
		if (!accepted.ok) {
			return accepted;
		}
		onCrdtPeerDetached?.({
			peerId: message.peerId,
			transportGeneration: message.transportGeneration,
			roomId: message.roomId,
		});
		return { ok: true };
	};

	const sendCrdtPacket = (
		packet: unknown,
		targetPeerId?: string,
	): ProductRoomCrdtSendResult => {
		if (!ownerLease) {
			pendingCrdtPackets.push({ packet, targetPeerId });
			return {
				ok: true,
				generation: transportGeneration,
			};
		}
		if (!ownerLease.attached) {
			pendingCrdtPackets.push({ packet, targetPeerId });
			return { ok: true, generation: ownerLease.transportGeneration };
		}
		if (!sendCrdtPacketToOwner(ownerLease, packet, targetPeerId)) {
			return {
				ok: false,
				errorCode: PRODUCT_ROOM_TRANSPORT_ERROR.NO_TRANSPORT_OWNER,
			};
		}
		return { ok: true, generation: ownerLease.transportGeneration };
	};

	const handleCrdtReceive = (
		message: ProductRoomCrdtReceive & { tabId: string },
	): ProductRoomTransportMessageResult => {
		const accepted = acceptsOwnerMessage(message);
		if (!accepted.ok) {
			return accepted;
		}
		onCrdtPacket?.({
			payload: message.packet,
			sourcePeerId: message.sourcePeerId,
			transportGeneration: message.transportGeneration,
			roomId: message.roomId,
		});
		return { ok: true };
	};

	const sendMediaPacket = (envelope: unknown, targetPeerId?: string): ProductRoomCrdtSendResult => {
		if (!ownerLease) {
			pendingMediaPackets.push({ envelope, targetPeerId });
			return { ok: true, generation: transportGeneration };
		}
		if (!ownerLease.attached) {
			pendingMediaPackets.push({ envelope, targetPeerId });
			return { ok: true, generation: ownerLease.transportGeneration };
		}
		if (!sendMediaPacketToOwner(ownerLease, envelope, targetPeerId)) {
			return { ok: false, errorCode: PRODUCT_ROOM_TRANSPORT_ERROR.NO_TRANSPORT_OWNER };
		}
		return { ok: true, generation: ownerLease.transportGeneration };
	};

	const handleMediaReceive = (
		message: ProductRoomMediaReceive & { tabId: string },
	): ProductRoomTransportMessageResult => {
		const accepted = acceptsOwnerMessage(message);
		if (!accepted.ok) {
			return accepted;
		}
		onMediaPacket?.({
			envelope: message.envelope,
			sourcePeerId: message.sourcePeerId,
			transportGeneration: message.transportGeneration,
			roomId: message.roomId,
		});
		return { ok: true };
	};

	const expireOwnerLease = (): void => {
		if (!ownerLease) {
			return;
		}
		if (now() - ownerLease.lastHeartbeatAt <= heartbeatTimeoutMs) {
			return;
		}
		disabledOwnerTabs.add(ownerLease.tabId);
		detachOwner(false);
		electOwner();
	};

	const getOwner = (): OwnerLease | null =>
		ownerLease ? { ...ownerLease } : null;

	return {
		setWorkspaceOpenState,
		registerTab,
		unregisterTab,
		handleOwnerHeartbeat,
		handleOwnerStatus,
		handleCrdtReceive,
		handleCrdtPeerAttached,
		handleCrdtPeerDetached,
		handleMediaReceive,
		sendCrdtPacket,
		sendMediaPacket,
		expireOwnerLease,
		getOwner,
	};
};
