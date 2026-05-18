import { useEffect, useState } from "react";
import {
	CRDT_HARNESS_INDEXEDDB_NAME,
	createCrdtHarnessStorageMetadata,
	scheduleCrdtHarnessReset,
} from "../dkt/crdt/browserHarnessStorage";
import {
	WORKSPACE_OPEN_FAILURE,
	getWorkspaceOpenFailureLabel,
	getWorkspaceOpenStatusLabel,
} from "../dkt/runtime/workspaceOpenState";

type DebugBridge = {
	getSnapshot: () => unknown;
	dumpGraph: () => unknown;
	dumpWorkerState: () => Promise<unknown>;
	getActiveProjectDetails: () => unknown;
	getRuntimeMessages: () => unknown;
};

type CrdtDebugSnapshot = {
	peerId: string;
	roomId: string | null;
	workspaceId: string;
	dbName: string;
	openStatus: string;
	openStatusCode: number | null;
	openFailureReason: number | null;
	openFailureReasonLabel: string | null;
	appSchemaVersion: number;
	derivedSchemaVersion: number;
	schemaDictionaryMode: string;
	storageBackend: string;
	outboxCount: number;
	openConflictsCount: number;
	lastError: string | null;
	status: string;
	bootError: string | null;
};

type CrdtDebugExport = {
	exportedAt: string;
	dbName: string;
	roomId: string | null;
	workspaceId: string;
	openStatus: string;
	snapshot: CrdtDebugSnapshot;
	workerState: unknown;
	graph: unknown;
	runtimeMessages: unknown;
	project: unknown;
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

const readStorageMetadata = (debug: DebugBridge | undefined) => {
	const pageSnapshot = debug?.getSnapshot() as { sessionKey?: unknown } | null;
	const roomId =
		typeof pageSnapshot?.sessionKey === "string" &&
		pageSnapshot.sessionKey !== "harness:standalone"
			? pageSnapshot.sessionKey
			: null;
	return createCrdtHarnessStorageMetadata(roomId);
};

const formatDebugError = (error: unknown): string | null => {
	if (!error) {
		return null;
	}
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	if (typeof error === "object") {
		const value = error as { message?: unknown; error?: unknown };
		if (typeof value.message === "string") {
			return value.message;
		}
		if (typeof value.error === "string") {
			return value.error;
		}
	}
	return "CRDT harness boot failed";
};

const readSnapshot = async (): Promise<CrdtDebugSnapshot> => {
	const debug = (window as typeof window & { __MINICUT_P2P_DEBUG__?: DebugBridge })
		.__MINICUT_P2P_DEBUG__;
	if (!debug) {
		const storageMetadata = createCrdtHarnessStorageMetadata(null);
		return {
			peerId: "not installed",
			roomId: storageMetadata.roomId,
			workspaceId: storageMetadata.workspaceId,
			dbName: storageMetadata.dbName,
			openStatus: "waiting",
			openStatusCode: null,
			openFailureReason: null,
			openFailureReasonLabel: null,
			appSchemaVersion: 1,
			derivedSchemaVersion: 1,
			schemaDictionaryMode: "none",
			storageBackend: storageMetadata.dbName,
			outboxCount: 0,
			openConflictsCount: 0,
			lastError: "debug bridge unavailable",
			status: "waiting",
			bootError: "Debug bridge is unavailable",
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
	const storageMetadata = readStorageMetadata(debug);
	const storageOpen = crdt?.storageOpen as
		| {
				ok?: unknown;
				status?: unknown;
				statusLabel?: unknown;
				failureReason?: unknown;
				failureReasonLabel?: unknown;
				openState?: { status?: unknown; failureReason?: unknown };
				manifest?: unknown;
		  }
		| null
		| undefined;
	const workspaceOpenState =
		storageOpen?.openState ??
		((workerState as { workspaceOpenState?: unknown } | null)
			?.workspaceOpenState as
			| { status?: unknown; failureReason?: unknown }
			| null
			| undefined);
	const openStatusCode =
		typeof workspaceOpenState?.status === "number"
			? workspaceOpenState.status
			: typeof storageOpen?.status === "number"
				? storageOpen.status
				: null;
	const openFailureReason =
		typeof workspaceOpenState?.failureReason === "number"
			? workspaceOpenState.failureReason
			: typeof storageOpen?.failureReason === "number"
				? storageOpen.failureReason
				: null;
	const miniCutManifest = storageOpen?.manifest as
		| {
				appSchemaVersion?: unknown;
				derivedSchemaVersion?: unknown;
				schemaDictionaryMode?: unknown;
		  }
		| null
		| undefined;
	const crdtEnabled =
		crdt?.enabled === true ||
		(typeof projectDetails?.projectId === "string" &&
			projectDetails.projectId.startsWith("crdt:"));
	const workerError =
		formatDebugError((workerState as { error?: unknown } | null)?.error) ?? null;

	return {
		peerId:
			typeof crdt?.peerId === "string"
				? crdt.peerId
				: typeof projectDetails?.projectId === "string"
					? projectDetails.projectId
					: "unknown",
		roomId: storageMetadata.roomId,
		workspaceId: storageMetadata.workspaceId,
		dbName: storageMetadata.dbName,
		openStatus:
			typeof storageOpen?.statusLabel === "string"
				? storageOpen.statusLabel
				: openStatusCode !== null
					? getWorkspaceOpenStatusLabel(openStatusCode)
					: typeof storageOpen?.failureReasonLabel === "string"
						? storageOpen.failureReasonLabel
					: crdtEnabled
						? "unknown"
						: "disabled",
		openStatusCode,
		openFailureReason,
		openFailureReasonLabel:
			openFailureReason === null || openFailureReason === WORKSPACE_OPEN_FAILURE.NONE
				? null
				: typeof storageOpen?.failureReasonLabel === "string"
					? storageOpen.failureReasonLabel
					: getWorkspaceOpenFailureLabel(openFailureReason),
		appSchemaVersion:
			typeof miniCutManifest?.appSchemaVersion === "number"
				? miniCutManifest.appSchemaVersion
				: 1,
		derivedSchemaVersion:
			typeof miniCutManifest?.derivedSchemaVersion === "number"
				? miniCutManifest.derivedSchemaVersion
				: 1,
		schemaDictionaryMode:
			typeof miniCutManifest?.schemaDictionaryMode === "string"
				? miniCutManifest.schemaDictionaryMode
				: "none",
		storageBackend: storageMetadata.dbName,
		outboxCount: readNumber(crdt?.outboxCount),
		openConflictsCount: summarizeOpenConflicts(graph),
		lastError:
			summarizeLastError(graph) ?? readRuntimeMessageError(messages) ?? workerError,
		status: crdtEnabled ? "ready" : "disabled",
		bootError:
			crdtEnabled || workerError
				? workerError
				: "CRDT runtime is not enabled in this harness",
	};
};

const readExport = async (
	snapshot: CrdtDebugSnapshot,
): Promise<CrdtDebugExport> => {
	const debug = (window as typeof window & { __MINICUT_P2P_DEBUG__?: DebugBridge })
		.__MINICUT_P2P_DEBUG__;
	return {
		exportedAt: new Date().toISOString(),
		dbName: snapshot.dbName,
		roomId: snapshot.roomId,
		workspaceId: snapshot.workspaceId,
		openStatus: snapshot.openStatus,
		snapshot,
		workerState: debug ? await debug.dumpWorkerState().catch(String) : null,
		graph: debug?.dumpGraph() ?? null,
		runtimeMessages: debug?.getRuntimeMessages() ?? null,
		project: debug?.getActiveProjectDetails() ?? null,
	};
};

const downloadJson = (filename: string, value: unknown): void => {
	const blob = new Blob([JSON.stringify(value, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.rel = "noopener";
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
};

export const CrdtDebugPanel = () => {
	const [open, setOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<CrdtDebugSnapshot>({
		peerId: "loading",
		roomId: null,
		workspaceId: createCrdtHarnessStorageMetadata(null).workspaceId,
		dbName: CRDT_HARNESS_INDEXEDDB_NAME,
		openStatus: "loading",
		openStatusCode: null,
		openFailureReason: null,
		openFailureReasonLabel: null,
		appSchemaVersion: 1,
		derivedSchemaVersion: 1,
		schemaDictionaryMode: "none",
		storageBackend: CRDT_HARNESS_INDEXEDDB_NAME,
		outboxCount: 0,
		openConflictsCount: 0,
		lastError: null,
		status: "loading",
		bootError: null,
	});
	const [toolMessage, setToolMessage] = useState<string | null>(null);

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

	const exportState = () => {
		void readExport(snapshot)
			.then((value) => {
				downloadJson(`minicut-crdt-harness-${Date.now()}.json`, value);
				setToolMessage("Exported JSON snapshot");
			})
			.catch((error) => {
				setToolMessage(
					error instanceof Error ? error.message : "Export failed",
				);
			});
	};

	const resetState = () => {
		if (
			window.confirm(
				"Clear this room's local CRDT harness IndexedDB state and reload this page? This debug action is not product workspace delete/reset.",
			)
		) {
			scheduleCrdtHarnessReset();
		}
	};

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
							<dt>workspace</dt>
							<dd>{snapshot.workspaceId}</dd>
						</div>
						<div>
							<dt>open</dt>
							<dd>
								{snapshot.openStatus}
								{snapshot.openStatusCode === null
									? ""
									: ` (${snapshot.openStatusCode})`}
							</dd>
						</div>
						<div>
							<dt>open failure</dt>
							<dd>
								{snapshot.openFailureReasonLabel ??
									getWorkspaceOpenFailureLabel(WORKSPACE_OPEN_FAILURE.NONE)}
								{snapshot.openFailureReason === null ||
								snapshot.openFailureReason === WORKSPACE_OPEN_FAILURE.NONE
									? ""
									: ` (${snapshot.openFailureReason})`}
							</dd>
						</div>
						<div>
							<dt>schema</dt>
							<dd>
								app {snapshot.appSchemaVersion} / derived{" "}
								{snapshot.derivedSchemaVersion} / dict{" "}
								{snapshot.schemaDictionaryMode}
							</dd>
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
					{snapshot.bootError ? (
						<p className="crdt-debug__error">
							CRDT boot/storage issue: {snapshot.bootError}
						</p>
					) : null}
					<div className="crdt-debug__actions">
						<button type="button" onClick={exportState}>
							Export JSON
						</button>
						<button type="button" onClick={resetState}>
							Reset IndexedDB
						</button>
					</div>
					{toolMessage ? (
						<p className="crdt-debug__message">{toolMessage}</p>
					) : null}
				</section>
			) : null}
		</div>
	);
};
