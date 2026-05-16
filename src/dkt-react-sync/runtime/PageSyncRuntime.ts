import type { ReactSyncScopeHandle } from "../scope/ScopeHandle";
import type { SyncStore } from "./createSyncStore";
import type { ReactScopeRuntime } from "./ReactScopeRuntime";

export interface PageRootSnapshot {
	booted: boolean;
	ready: boolean;
	version: number;
	rootNodeId: string | null;
	sessionId: string | null;
	sessionKey: string | null;
}

export interface PageSyncRuntime extends ReactScopeRuntime {
	store: SyncStore<PageRootSnapshot>;
	bootstrap(options?: {
		sessionId?: string | null;
		sessionKey?: string | null;
		route?: unknown;
	}): void;
	debugDescribeNode(nodeId: string): unknown;
	debugDumpGraph(): unknown;
	debugMessages(): readonly unknown[];
	/** Debug-only: requests a full serialised worker model state. Promise resolves when the worker responds. */
	requestDebugDump?(): Promise<unknown>;
	/** Debug-only: waits for the DKT worker and page sync runtime to settle. */
	waitForRuntimeSettled?(): Promise<void>;
	/** Test-only: applies a compact sync update to the page read model. */
	applyDebugSyncUpdateTesting?(list: readonly unknown[]): void;
	dispatchAction(
		actionName: string,
		payload?: unknown,
		scope?: ReactSyncScopeHandle | null,
	): void;
	destroy(): void;
	getSnapshot(): PageRootSnapshot;
	getRootAttrs(attrNames: readonly string[]): Record<string, unknown>;
	subscribe(listener: () => void): () => void;
	subscribeRootAttrs(
		attrNames: readonly string[],
		listener: () => void,
	): () => void;
	subscribeRuntimeTaskRequests?(
		fxName: `$fx_${string}`,
		listener: (payload: unknown) => void,
	): () => void;
}
