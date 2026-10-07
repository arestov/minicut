import { updateRel } from "dkt-all/libs/provoda/provoda/updateRel.js";

/**
 * The app `sessions` rel is the pool of live session roots. `hookSessionRoot`
 * never writes app rels, the runtime boundary fills it (like Linkcraft does).
 * All functions run inside an `appModel.input` flow.
 */
export type SessionPoolApp = {
	queryRel(name: string): Promise<readonly SessionPoolRoot[] | null | undefined>;
};
export type SessionPoolRoot = { _node_id?: string | null };

const read = async (app: SessionPoolApp): Promise<readonly SessionPoolRoot[]> =>
	(await app.queryRel("sessions")) ?? [];

/**
 * Keeps only the given live roots. After a reinit the stored `sessions` hold
 * roots of a runtime that no longer exists.
 */
export const pruneSessionPool = async (
	app: SessionPoolApp,
	live: readonly SessionPoolRoot[],
): Promise<void> => {
	const list = await read(app);
	const kept = list.filter((item) =>
		live.some((root) => root._node_id === item._node_id),
	);
	if (kept.length === list.length) return;
	await updateRel(app, "sessions", kept);
};

export const addSessionRoot = async (
	app: SessionPoolApp,
	root: SessionPoolRoot,
): Promise<void> => {
	const list = await read(app);
	if (list.some((item) => item._node_id === root._node_id)) return;
	await updateRel(app, "sessions", [...list, root]);
};

export const removeSessionRoot = async (
	app: SessionPoolApp,
	root: SessionPoolRoot,
): Promise<void> => {
	const list = await read(app);
	if (!list.some((item) => item._node_id === root._node_id)) return;
	await updateRel(
		app,
		"sessions",
		list.filter((item) => item._node_id !== root._node_id),
	);
};
