import {
	WORKSPACE_OPEN_STATUS,
	type WorkspaceOpenState,
} from "../dkt/runtime/workspaceOpenState";
import {
	PRODUCT_ROOM_MSG,
	WEBRTC_OWNER_STATUS,
	type ProductRoomAttachWebRtc,
	type ProductRoomDetachWebRtc,
	type ProductRoomProtocolMessage,
	type ProductRoomTabHello,
	type ProductRoomWebRtcOwnerStatus,
} from "./productRoomProtocol";

type ProductRoomTransportOwnerTab = {
	hello: ProductRoomTabHello;
	send(message: ProductRoomProtocolMessage): void;
};

type ProductRoomTransportOwnerOptions = {
	roomId: string;
	heartbeatTimeoutMs?: number;
	createTransportOwnerToken?: (tabId: string) => string;
	now?: () => number;
};

type OwnerLease = {
	tabId: string;
	transportOwnerToken: string;
	lastHeartbeatAt: number;
};

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;

const canAttachForWorkspace = (state: WorkspaceOpenState | null): boolean =>
	state?.status === WORKSPACE_OPEN_STATUS.READY ||
	state?.status === WORKSPACE_OPEN_STATUS.EMPTY_INITIALIZED;

export const createProductRoomTransportOwner = ({
	roomId,
	heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
	createTransportOwnerToken,
	now = () => Date.now(),
}: ProductRoomTransportOwnerOptions) => {
	const tabs = new Map<string, ProductRoomTransportOwnerTab>();
	const disabledOwnerTabs = new Set<string>();
	let tokenSequence = 0;
	let workspaceOpenState: WorkspaceOpenState | null = null;
	let ownerLease: OwnerLease | null = null;

	const nextToken = (tabId: string): string =>
		createTransportOwnerToken?.(tabId) ??
		`room-owner:${roomId}:${tabId}:${++tokenSequence}`;

	const sendDetach = (lease: OwnerLease): void => {
		const ownerTab = tabs.get(lease.tabId);
		if (!ownerTab) {
			return;
		}
		ownerTab.send({
			type: PRODUCT_ROOM_MSG.DETACH_WEBRTC,
			roomId,
			transportOwnerToken: lease.transportOwnerToken,
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
				transportOwnerToken: nextToken(tabId),
				lastHeartbeatAt: now(),
			};
			ownerLease = lease;
			tab.send({
				type: PRODUCT_ROOM_MSG.ATTACH_WEBRTC,
				roomId,
				transportOwnerToken: lease.transportOwnerToken,
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

	const handleOwnerHeartbeat = ({
		tabId,
		roomId: heartbeatRoomId,
		transportOwnerToken,
	}: {
		tabId: string;
		roomId: string;
		transportOwnerToken: string;
	}): void => {
		if (
			!ownerLease ||
			ownerLease.tabId !== tabId ||
			ownerLease.transportOwnerToken !== transportOwnerToken ||
			heartbeatRoomId !== roomId
		) {
			return;
		}
		ownerLease.lastHeartbeatAt = now();
	};

	const handleOwnerStatus = (message: ProductRoomWebRtcOwnerStatus): void => {
		if (
			!ownerLease ||
			ownerLease.tabId !== message.tabId ||
			ownerLease.transportOwnerToken !== message.transportOwnerToken
		) {
			return;
		}
		if (message.status === WEBRTC_OWNER_STATUS.ATTACHED) {
			ownerLease.lastHeartbeatAt = now();
			return;
		}
		if (message.status === WEBRTC_OWNER_STATUS.REJECTED_ROOM_MISMATCH) {
			disabledOwnerTabs.add(message.tabId);
		}
		detachOwner(message.status !== WEBRTC_OWNER_STATUS.CLOSED);
		electOwner();
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
		expireOwnerLease,
		getOwner,
	};
};
