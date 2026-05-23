export const crdtReviewResourceDeps = {
	conflictById: "$meta$crdt/conflict/[:conflict_id]",
	conflictGroupById: "$meta$crdt/conflict-group/[:conflict_group_id]",
	syncBatchById: "$meta$crdt/sync-batch/[:batch_id]",
	conflictsByScope:
		"$meta$crdt/conflicts/by-scope/[:scope]/[:status::unresolved]/[:limit::100]",
} as const;

