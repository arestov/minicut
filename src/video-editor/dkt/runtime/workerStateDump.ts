/**
 * Debug/testing utility: on-demand full worker state dump.
 *
 * Serialises every model visible to the DKT runtime at the moment of the call.
 * Two collections are returned:
 *   lined         - getLinedStructure() tree (DKT's own linked view)
 *   runtimeModels - raw models map from the runtime's internal registry
 *
 * NOT imported by any production bundle - only used through the debug message
 * channel (DEBUG_DUMP_REQUEST / DEBUG_DUMP_RESPONSE) or the testing helpers.
 */
import {
	_getCurrentRel,
	_listRels,
} from "dkt-all/libs/provoda/_internal/_listRels.js";

export type WorkerModelDump = {
	nodeId: string | null;
	modelName: string | null;
	attrs: Record<string, unknown>;
	rels: Record<string, readonly (string | null)[] | string | null>;
};

export type WorkerStateDump = {
	timestamp: string;
	lined: WorkerModelDump[];
	runtimeModels: WorkerModelDump[];
};

type RuntimeModelLike = {
	_node_id?: string | null;
	model_name?: string | null;
	states?: Record<string, unknown>;
	__getPublicAttrs?: () => readonly string[];
	getLinedStructure?: (
		options: unknown,
		config: unknown,
	) => Promise<readonly RuntimeModelLike[]> | readonly RuntimeModelLike[];
};

const serializeRef = (value: unknown): unknown => {
	if (value == null) {
		return null;
	}
	if (Array.isArray(value)) {
		return value.map(serializeRef);
	}
	if (typeof value === "object" && "_node_id" in value) {
		return (value as { _node_id?: unknown })._node_id ?? null;
	}
	return value;
};

const serializeModel = (model: RuntimeModelLike): WorkerModelDump => {
	const publicAttrs = model.__getPublicAttrs?.() ?? [];
	const attrs = Object.fromEntries(
		publicAttrs.map((name) => [name, serializeRef(model.states?.[name])]),
	);
	const relNames = Array.from(_listRels(model)).sort();
	const rels = Object.fromEntries(
		relNames.map((relName) => [
			relName,
			serializeRef(_getCurrentRel(model, relName)),
		]),
	) as WorkerModelDump["rels"];
	return {
		nodeId: model._node_id ?? null,
		modelName: model.model_name ?? null,
		attrs,
		rels,
	};
};

/**
 * Produce a full state dump.  Call this from inside the worker runtime after it
 * has booted; pass the app model returned by runtime.start() and the raw models
 * map from runtime.models.
 */
export const dumpWorkerAppState = async (
	appModel: RuntimeModelLike,
	runtimeModels: Record<string, RuntimeModelLike>,
): Promise<WorkerStateDump> => {
	const lined = (await appModel.getLinedStructure?.({}, {})) ?? [];
	return {
		timestamp: new Date().toISOString(),
		lined: (lined as RuntimeModelLike[]).map(serializeModel),
		runtimeModels: Object.values(runtimeModels).map(serializeModel),
	};
};
