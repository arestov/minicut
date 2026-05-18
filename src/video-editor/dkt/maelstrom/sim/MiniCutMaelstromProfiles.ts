import { indexedDB } from "fake-indexeddb";
import type { MiniCutDktCrdtStorageOptions } from "../../testingInit";
import {
	createMiniCutHarnessWorkspaceId,
	createMiniCutWorkspaceDbName,
} from "../../storage/minicutWorkspaceManifest";

let nextIndexedDbId = 0;

export type MiniCutMaelstromProfile = {
	name: "memory" | "lazy-indexeddb" | "room-workspace-indexeddb";
	unloadModels: boolean;
	roomId?: string;
	workspaceIdForPeer?: (peerId: string) => string;
	dbNameForPeer?: (peerId: string) => string;
	storage?: MiniCutDktCrdtStorageOptions | ((peerId: string) => MiniCutDktCrdtStorageOptions);
};

export const createMiniCutMaelstromProfiles = (): MiniCutMaelstromProfile[] => {
	const indexedDbName = (label: string, peerId: string) =>
		`minicut-maelstrom-${label}-${peerId}-${Date.now()}-${nextIndexedDbId++}`;
	let roomWorkspaceRoomId = `maelstrom-room-${Date.now()}-${nextIndexedDbId++}`;
	const nextRoomWorkspaceRun = () => {
		roomWorkspaceRoomId = `maelstrom-room-${Date.now()}-${nextIndexedDbId++}`;
	};
	const roomWorkspaceId = (peerId: string) =>
		createMiniCutHarnessWorkspaceId(`${roomWorkspaceRoomId}:${peerId}`);
	const roomWorkspaceDbName = (peerId: string) =>
		createMiniCutWorkspaceDbName(roomWorkspaceId(peerId));

	return [
		{ name: "memory", unloadModels: false, storage: "memory" },
		{
			name: "lazy-indexeddb",
			unloadModels: true,
			storage: (peerId) => ({
				type: "indexeddb",
				dbName: indexedDbName("lazy-indexeddb", peerId),
				indexedDB,
			}),
		},
		{
			name: "room-workspace-indexeddb",
			unloadModels: false,
			roomId: roomWorkspaceRoomId,
			workspaceIdForPeer: roomWorkspaceId,
			dbNameForPeer: roomWorkspaceDbName,
			storage: (peerId) => {
				if (peerId === "A") {
					nextRoomWorkspaceRun();
				}
				return {
					type: "indexeddb",
					dbName: roomWorkspaceDbName(peerId),
					indexedDB,
				};
			},
		},
	];
};
