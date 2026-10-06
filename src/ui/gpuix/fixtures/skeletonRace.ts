import { SYNCR_TYPES } from "dkt-all/libs/provoda/SyncR_TYPES.js";
import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import { createMiniCutPageSyncRuntime } from "../../../video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import {
	DKT_MSG,
	type MiniCutDktTransportMessage,
} from "../../../video-editor/dkt/shared/messageTypes";

type Message = MiniCutDktTransportMessage;

// Wire dictionary of the fixture: the index is the key used in sync updates.
const DICT = [undefined, "title", "tracks", "name", "kind"] as const;
const KEY = { title: 1, tracks: 2, name: 3, kind: 4 } as const;
type FixtureAttr = Exclude<keyof typeof KEY, "tracks">;

const ROOT_NODE_ID = "root";

export type SkeletonRaceFixture = {
	runtime: PageSyncRuntime;
	/** Node ids of the tracks that were delivered as a bare rel. */
	trackNodeIds: readonly string[];
	/** Delivers the attrs of one track, which until now had none. */
	deliverTrackAttrs(
		nodeId: string,
		attrs: Partial<Record<FixtureAttr, string>>,
	): void;
	/** Delivers attrs of every track in one sync update. */
	deliverAllTrackAttrs(
		attrsByNodeId: Record<string, Partial<Record<FixtureAttr, string>>>,
	): void;
	destroy(): void;
};

/**
 * A page sync runtime fed by hand-written sync messages through the real
 * page receiver (no DKT runtime). The root arrives with its `tracks` rel
 * already filled with node ids, but the tracks themselves have no attrs yet:
 * the skeleton race of docs/main-ru.md (rel before attrs). Components must
 * not render a track before an attr they depend on (ReadyGate/readyAttr).
 */
export const createSkeletonRaceFixture = (
	trackNodeIds: readonly string[] = ["track-v1", "track-a1"],
): SkeletonRaceFixture => {
	const listeners = new Set<(message: Message) => void>();
	const transport: DomSyncTransportLike<Message> = {
		send() {},
		listen(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		destroy() {
			listeners.clear();
		},
	};
	const emit = (message: Message) => {
		for (const listener of [...listeners]) {
			listener(message);
		}
	};
	const emitSync = (syncType: number, payload: unknown) => {
		emit({ type: DKT_MSG.SYNC_HANDLE, syncType, payload } as Message);
	};
	const attrsUpdate = (
		nodeId: string,
		attrs: Partial<Record<FixtureAttr, string>>,
	): unknown[] => {
		const flat = Object.entries(attrs).flatMap(([name, value]) => [
			KEY[name as FixtureAttr],
			value,
		]);
		return [0, nodeId, flat.length, ...flat];
	};

	const runtime = createMiniCutPageSyncRuntime({ transport });
	runtime.bootstrap({ sessionKey: "skeleton-race" });

	emit({
		type: DKT_MSG.RUNTIME_READY,
		sessionKey: "skeleton-race",
		rootNodeId: ROOT_NODE_ID,
	} as Message);
	emitSync(SYNCR_TYPES.SET_DICT, DICT);
	emitSync(SYNCR_TYPES.TREE_ROOT, {
		node_id: ROOT_NODE_ID,
		data: [null, null, null],
	});
	// Root attrs and the rel arrive; the tracks it points at have no attrs.
	emitSync(SYNCR_TYPES.UPDATE, [
		...attrsUpdate(ROOT_NODE_ID, { title: "Skeleton project" }),
		1,
		ROOT_NODE_ID,
		KEY.tracks,
		[...trackNodeIds],
	]);

	return {
		runtime,
		trackNodeIds,
		deliverTrackAttrs(nodeId, attrs) {
			emitSync(SYNCR_TYPES.UPDATE, attrsUpdate(nodeId, attrs));
		},
		deliverAllTrackAttrs(attrsByNodeId) {
			emitSync(
				SYNCR_TYPES.UPDATE,
				Object.entries(attrsByNodeId).flatMap(([nodeId, attrs]) =>
					attrsUpdate(nodeId, attrs),
				),
			);
		},
		destroy() {
			runtime.destroy();
		},
	};
};
