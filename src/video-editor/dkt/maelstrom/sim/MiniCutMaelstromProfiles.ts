import { indexedDB } from "fake-indexeddb";
import type { MiniCutDktCrdtStorageOptions } from "../../testingInit";

let nextIndexedDbId = 0;

export type MiniCutMaelstromProfile = {
	name: "memory" | "lazy-indexeddb";
	unloadModels: boolean;
	storage?: MiniCutDktCrdtStorageOptions | ((peerId: string) => MiniCutDktCrdtStorageOptions);
};

export const createMiniCutMaelstromProfiles = (): MiniCutMaelstromProfile[] => {
	const indexedDbName = (label: string, peerId: string) =>
		`minicut-maelstrom-${label}-${peerId}-${Date.now()}-${nextIndexedDbId++}`;

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
	];
};
