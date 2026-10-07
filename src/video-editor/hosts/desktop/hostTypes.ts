import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";

/**
 * What the GPUIX-side executors need from the page sync runtime. Results go
 * back through the same model actions the Web page executors use (same
 * delivery as web page executors): one dispatch per event.
 */
export type HostPage = Pick<
	PageSyncRuntime,
	"dispatch" | "dispatchAndWait" | "getRootScope"
>;

/** Handle of a model node addressed by its node id (carried in effect payloads). */
export const scopeFor = (nodeId: string): ReactSyncScopeHandle => ({
	kind: "scope",
	_nodeId: nodeId,
});

/**
 * Process-local store for values that must not enter the graph (file paths,
 * handles). The graph only carries the returned `runtimeHandleId`.
 */
export type RuntimeRefs = {
	put(value: unknown): string;
	get(runtimeHandleId: string): unknown;
	consume(runtimeHandleId: string): unknown;
	delete(runtimeHandleId: string): void;
};
