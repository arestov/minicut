export type CrdtConflictStatus = "open" | "acknowledged" | "resolved";

export type CrdtActionTrace = {
	trace_version: 2;
	frames: Array<{
		frame_id: number;
		parent_frame_id?: number | null;
		scheduled_by_frame_id?: number | null;
		target_node_id?: string | null;
		target_model_name?: string | null;
	}>;
	produced_ops: Array<{ frame_id: number; op_id: string }>;
	produced_creates: Array<{ frame_id: number; node_id: string }>;
};

export type CrdtConflictRecord = {
	conflict_id: string;
	status: CrdtConflictStatus;
	kind: string;
	node_id?: string | null;
	model_name?: string | null;
	field_kind?: "attr" | "rel" | string | null;
	field_name?: string | null;
	aggregate?: string | null;
	scope?: string | null;
	payload?: unknown;
	details?: unknown;
	variants?: unknown;
	impact_summary?: unknown;
	details_available?: boolean;
	conflict_group_id?: string | null;
	anchor_conflict_id?: string | null;
	grouped_conflict_ids?: string[];
	source_frame_id?: number | null;
	source_root_frame_id?: number | null;
	batch_id?: string | null;
	origin_peer_id?: string | null;
	happened_at?: number | null;
};

export type CrdtSyncBatch = {
	batch_id: string;
	origin_peer_id: string;
	runtime_transaction_id: string | null;
	intent: unknown | null;
	created_models: unknown[];
	tombstones: unknown[];
	ops: unknown[];
	action_trace: CrdtActionTrace | null;
};

export type CrdtSyncPayload = CrdtSyncBatch & {
	event_type: "crdt_sync";
	event_id?: string;
	reason?: string;
	clock?: unknown;
	applied_ops: unknown[];
	rejected_ops: unknown[];
	opened_conflict_ids: string[];
	updated_conflict_ids: string[];
	resolved_conflict_ids?: string[];
	acknowledged_conflict_ids?: string[];
	touched_node_ids: string[];
	touched_model_names: string[];
	affected_scopes?: string[];
	happened_at: number;
};

export type CrdtConflictLifecyclePayload = {
	event_type: "crdt_conflict";
	event_id?: string;
	reason?: string;
	batch_id?: string | null;
	happened_at: number;
	opened: CrdtConflictRecord[];
	updated: CrdtConflictRecord[];
	acknowledged: CrdtConflictRecord[];
	resolved: CrdtConflictRecord[];
	previous: Record<string, CrdtConflictRecord | null>;
};

export type MiniCutReviewKind =
	| "clip_timing"
	| "dangling_resource"
	| "delete_vs_edit"
	| "track_order"
	| "unknown";

export type MiniCutReviewObject = {
	type: string;
	id: string;
	label?: string;
};

export type MiniCutReviewItem = {
	id: string;
	conflictId: string;
	projectId: string;
	kind: MiniCutReviewKind;
	status: CrdtConflictStatus;
	title: string;
	affectedObjects: MiniCutReviewObject[];
	preview: unknown;
	availableActions: string[];
	source: {
		conflictId: string;
		conflictGroupId?: string;
		syncBatchId?: string;
		frameId?: number;
		rootFrameId?: number;
	};
};

export type MiniCutActivitySummary = {
	id: string;
	projectId: string;
	batchId: string;
	originPeerId: string;
	title: string;
	created: MiniCutReviewObject[];
	updated: MiniCutReviewObject[];
	deleted: MiniCutReviewObject[];
	rootFrames: Array<{ frameId: number; opCount: number; createCount: number }>;
	happenedAt: number;
};

export type MiniCutReviewSessionSnapshot = {
	projectId: string;
	items: MiniCutReviewItem[];
	activitySummaries: MiniCutActivitySummary[];
};

