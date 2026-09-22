import { sync_sender as SyncSender } from "dkt-all/libs/provoda/sync_sender.js";
import {
	addShapes,
	initShapes,
} from "dkt-all/libs/provoda/sync/shapes.js";
import { describe, expect, it, vi } from "vitest";

describe("current DKT SyncSender compatibility", () => {
	it("accepts activation-based requests and keeps fragment refs independent", async () => {
		const pendingInputs: Promise<void>[] = [];
		const runtime = { models: Object.create(null) as Record<string, unknown> };
		const sender = new SyncSender(runtime);
		const stream = {
			id: "react-contract-stream",
			send: vi.fn(),
			sendWithType: vi.fn(),
			pulled_from_state_queue: [] as unknown[],
			pushed_by_state_queue: [] as unknown[],
			to_pull_from_state: vi.fn(),
		};
		initShapes(stream);
		addShapes(stream, {
			shapeTitle: { id: "shapeTitle", t: 0, a: [], r: [] },
			shapeStatus: { id: "shapeStatus", t: 0, a: [], r: [] },
		});
		sender.sockets[stream.id] = stream;
		sender.sockets_m_index[stream.id] = Object.create(null);
		sender.dict_by_id[stream.id] = {
			nameToNum: { Thing: 0 },
			numToName: { 0: "Thing" },
		};
		runtime.models["node-1"] = {
			_node_id: "node-1",
			model_name: "Thing",
			hierarchy_num: 1,
			constr_id: 1,
			states: Object.create(null),
			children_models: Object.create(null),
			_attrs_collector: { attrs: Object.create(null) },
			_highway: {
				current_draft_replay: null,
				getCurrentStateTransaction: () => null,
			},
			input(callback: () => Promise<void>) {
				const pending = Promise.resolve(callback());
				pendingInputs.push(pending);
				return pending;
			},
		};

		sender.requireShapeForModel(stream.id, {
			node_id: "node-1",
			activation_id: "react-fragment:title",
			shape_ids: ["shapeTitle"],
		});
		sender.requireShapeForModel(stream.id, {
			node_id: "node-1",
			activation_id: "react-fragment:status",
			shape_ids: ["shapeStatus"],
		});
		await Promise.all(pendingInputs.splice(0));

		expect(stream.node_id_to_shape_list.get("node-1")).toEqual([
			"shapeTitle",
			"shapeStatus",
		]);

		sender.requireShapeForModel(stream.id, {
			node_id: "node-1",
			activation_id: "react-fragment:title",
			shape_ids: [],
		});
		await Promise.all(pendingInputs.splice(0));

		expect(stream.node_id_to_shape_list.get("node-1")).toEqual([
			"shapeStatus",
		]);
	});
});
