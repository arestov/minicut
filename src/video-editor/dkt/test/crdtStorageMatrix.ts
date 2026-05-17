import { indexedDB } from "fake-indexeddb";
import type { MiniCutDktCrdtStorageOptions } from "../testingInit";

let nextIndexedDbId = 0;

export type MiniCutCrdtStorageProfile = {
	name: "memory" | "indexeddb" | "lazy-indexeddb";
	unloadModels: boolean;
	storage: MiniCutDktCrdtStorageOptions;
};

export const createMiniCutCrdtStorageProfiles =
	(): MiniCutCrdtStorageProfile[] => {
		const indexedDbName = (label: string) =>
			`minicut-crdt-${label}-${Date.now()}-${nextIndexedDbId++}`;

		return [
			{
				name: "memory",
				unloadModels: false,
				storage: "memory",
			},
			{
				name: "indexeddb",
				unloadModels: false,
				storage: {
					type: "indexeddb",
					dbName: indexedDbName("indexeddb"),
					indexedDB,
				},
			},
			{
				name: "lazy-indexeddb",
				unloadModels: true,
				storage: {
					type: "indexeddb",
					dbName: indexedDbName("lazy-indexeddb"),
					indexedDB,
				},
			},
		];
	};
