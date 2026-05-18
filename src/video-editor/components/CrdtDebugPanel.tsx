import { useEffect, useState } from "react";

type DebugBridge = {
	dumpGraph: () => unknown;
	dumpWorkerState: () => Promise<unknown>;
	getActiveProjectDetails: () => unknown;
	getRuntimeMessages: () => unknown;
};

type CrdtDebugSnapshot = {
	peerId: string;
	storageBackend: string;
	outboxCount: number;
	openConflictsCount: number;
	lastError: string | null;
	status: string;
};

const readNumber = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

const summarizeOpenConflicts = (graph: unknown): number => {
	if (!graph || typeof graph !== "object") {
		return 0;
	}
	const nodes = (graph as { nodes?: Array<{ attrs?: Record<string, unknown> }> })
		.nodes;
	if (!Array.isArray(nodes)) {
		return 0;
	}

	return nodes.reduce((total, node) => {
		const attrs = node.attrs ?? {};
		return total + readNumber(attrs["$meta$model$crdt$open_conflicts_count"]);
	}, 0);
};

const summarizeLastError = (graph: unknown): string | null => {
	if (!graph || typeof graph !== "object") {
		return null;
	}
	const nodes = (graph as { nodes?: Array<{ attrs?: Record<string, unknown> }> })
		.nodes;
	if (!Array.isArray(nodes)) {
		return null;
	}

	for (const node of nodes) {
		const attrs = node.attrs ?? {};
		const error =
			attrs["$meta$aggregates$crdt$clipTiming$last_resolution_error"];
		if (error && typeof error === "object") {
			const message = (error as { message?: unknown; code?: unknown }).message;
			const code = (error as { message?: unknown; code?: unknown }).code;
			return typeof message === "string"
				? message
				: typeof code === "string"
					? code
					: "resolution error";
		}
	}
	return null;
};

const readRuntimeMessageError = (messages: unknown): string | null => {
	if (!Array.isArray(messages)) {
		return null;
	}
	const lastError = [...messages].reverse().find((message) => {
		if (!message || typeof message !== "object") {
			return false;
		}
		const value = message as { level?: unknown; type?: unknown; error?: unknown };
		return value.level === "error" || value.type === "error" || value.error;
	});
	if (!lastError || typeof lastError !== "object") {
		return null;
	}
	const value = lastError as { error?: unknown; message?: unknown; type?: unknown };
	if (typeof value.error === "string") {
		return value.error;
	}
	if (typeof value.message === "string") {
		return value.message;
	}
	return typeof value.type === "string" ? value.type : "runtime error";
};

const readSnapshot = async (): Promise<CrdtDebugSnapshot> => {
	const debug = (window as typeof window & { __MINICUT_P2P_DEBUG__?: DebugBridge })
		.__MINICUT_P2P_DEBUG__;
	if (!debug) {
		return {
			peerId: "not installed",
			storageBackend: "indexeddb harness",
			outboxCount: 0,
			openConflictsCount: 0,
			lastError: "debug bridge unavailable",
			status: "waiting",
		};
	}

	const [workerState, graph, messages] = await Promise.all([
		debug.dumpWorkerState().catch((error: unknown) => ({ error })),
		Promise.resolve(debug.dumpGraph()),
		Promise.resolve(debug.getRuntimeMessages()),
	]);
	const projectDetails = debug.getActiveProjectDetails() as {
		projectId?: unknown;
	} | null;
	const crdt = (workerState as { crdt?: Record<string, unknown> } | null)?.crdt;
	const crdtEnabled =
		crdt?.enabled === true ||
		(typeof projectDetails?.projectId === "string" &&
			projectDetails.projectId.startsWith("crdt:"));
	const workerError =
		(workerState as { error?: unknown } | null)?.error instanceof Error
			? (workerState as { error: Error }).error.message
			: null;

	return {
		peerId:
			typeof crdt?.peerId === "string"
				? crdt.peerId
				: typeof projectDetails?.projectId === "string"
					? projectDetails.projectId
					: "unknown",
		storageBackend: "indexeddb harness",
		outboxCount: readNumber(crdt?.outboxCount),
		openConflictsCount: summarizeOpenConflicts(graph),
		lastError:
			summarizeLastError(graph) ?? readRuntimeMessageError(messages) ?? workerError,
		status: crdtEnabled ? "ready" : "disabled",
	};
};

export const CrdtDebugPanel = () => {
	const [open, setOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<CrdtDebugSnapshot>({
		peerId: "loading",
		storageBackend: "indexeddb harness",
		outboxCount: 0,
		openConflictsCount: 0,
		lastError: null,
		status: "loading",
	});

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			void readSnapshot().then((nextSnapshot) => {
				if (!cancelled) {
					setSnapshot(nextSnapshot);
				}
			});
		};
		refresh();
		const interval = window.setInterval(refresh, open ? 1000 : 2500);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [open]);

	return (
		<div className="crdt-debug">
			<button
				type="button"
				className="crdt-debug__toggle"
				aria-expanded={open}
				aria-controls="crdt-debug-panel"
				title="CRDT harness debug"
				onClick={() => setOpen((value) => !value)}
			>
				CRDT
			</button>
			{open ? (
				<section
					id="crdt-debug-panel"
					className="crdt-debug__panel"
					aria-label="CRDT debug panel"
				>
					<header className="crdt-debug__header">
						<strong>CRDT harness</strong>
						<span data-status={snapshot.status}>{snapshot.status}</span>
					</header>
					<dl className="crdt-debug__grid">
						<div>
							<dt>peer</dt>
							<dd>{snapshot.peerId}</dd>
						</div>
						<div>
							<dt>storage</dt>
							<dd>{snapshot.storageBackend}</dd>
						</div>
						<div>
							<dt>outbox</dt>
							<dd>{snapshot.outboxCount}</dd>
						</div>
						<div>
							<dt>conflicts</dt>
							<dd>{snapshot.openConflictsCount}</dd>
						</div>
					</dl>
					{snapshot.lastError ? (
						<p className="crdt-debug__error">{snapshot.lastError}</p>
					) : null}
				</section>
			) : null}
		</div>
	);
};
