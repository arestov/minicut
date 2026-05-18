import type { ReactSyncScopeHandle } from "../../../dkt-react-sync/scope/ScopeHandle";
import type { VideoEditorHarness } from "../createVideoEditorHarness";

type MiniCutDebugBridge = {
	getSnapshot: () => unknown;
	dumpGraph: () => unknown;
	dumpGraphSummary: () => unknown;
	dumpRuntimeTasks: () => unknown;
	dumpProjectState: () => unknown;
	getResourceTransfers: () => unknown;
	getProjectCount: () => number;
	getProjectTitles: () => string[];
	getActiveProjectTracks: () => unknown;
	getActiveProjectPrimaryTracks: () => unknown;
	getSelectionState: () => unknown;
	getActiveProjectDetails: () => unknown;
	getRuntimeMessages: () => unknown;
	dumpWorkerState: () => Promise<unknown>;
	getRole: () => string | null;
	isRuntimeReady: () => boolean;
	waitForRuntimeSettled: () => Promise<void>;
	getPeerId: () => string | null;
	createProject: (title?: string) => void;
	dispatchRootAction: (actionName: string, payload?: unknown) => Promise<void>;
	dispatchProjectAction: (
		actionName: string,
		payload?: unknown,
	) => Promise<void>;
	injectFirstClipConflictTesting: (options?: {
		kind?: string;
		scope?: string;
		summary?: string;
		timing?: boolean;
	}) => Promise<{ clipId: string; conflictId: string }>;
	injectFirstClipResolutionErrorTesting: (options?: {
		code?: string;
		message?: string;
		fieldCode?: string;
	}) => Promise<{ clipId: string }>;
	clearFirstClipConflictTesting: () => Promise<{ clipId: string }>;
	setCursor: (cursor: number) => void;
	dispatchCreateProject: (title?: string) => Promise<void>;
};

declare global {
	interface Window {
		__MINICUT_P2P_DEBUG__?: MiniCutDebugBridge;
	}
}

const summarizeGraph = (graph: unknown) => {
	if (!graph || typeof graph !== "object") {
		return graph;
	}

	const value = graph as {
		nodes?: Array<{
			nodeId?: unknown;
			modelName?: unknown;
			rels?: unknown;
			attrsVersion?: unknown;
			relsVersion?: unknown;
		}>;
		models?: Record<
			string,
			{ attrs?: unknown; rels?: Array<{ name?: unknown }> }
		>;
	};
	const summary: Record<string, unknown> = {};

	if (Array.isArray(value.nodes)) {
		summary.nodes = value.nodes.map((node) => ({
			nodeId: node.nodeId,
			modelName: node.modelName,
			relNames:
				node.rels && typeof node.rels === "object"
					? Object.keys(node.rels as Record<string, unknown>)
					: [],
			attrsVersion: node.attrsVersion,
			relsVersion: node.relsVersion,
		}));
	}

	if (value.models && typeof value.models === "object") {
		summary.models = Object.fromEntries(
			Object.entries(value.models).map(([modelName, model]) => [
				modelName,
				{
					attrsCount: Array.isArray(model.attrs)
						? model.attrs.length
						: undefined,
					relNames: Array.isArray(model.rels)
						? model.rels
								.map((rel) => rel.name)
								.filter((name): name is string => typeof name === "string")
						: undefined,
				},
			]),
		);
	}

	return summary;
};

const getActiveProjectScopeTesting = (
	harness: VideoEditorHarness,
): ReactSyncScopeHandle | null => {
	const pageRuntime = harness.pageRuntime;
	if (!pageRuntime) {
		return null;
	}

	const rootScope = pageRuntime.getRootScope();
	if (!rootScope) {
		return null;
	}

	const activeProject = pageRuntime.readOne(rootScope, "activeProject");
	if (activeProject) {
		return activeProject;
	}

	const pioneerScope = pageRuntime.readOne(rootScope, "pioneer");
	if (!pioneerScope) {
		return null;
	}

	const projects = pageRuntime.readMany(pioneerScope, "project");
	return projects[0] ?? null;
};

export const installMiniCutDebugBridgeTesting = (
	harness: VideoEditorHarness,
): (() => void) => {
	if (typeof window === "undefined") {
		return () => {};
	}

	const getActiveProjectScope = () => getActiveProjectScopeTesting(harness);
	const waitForRuntimeSettled = () =>
		harness.pageRuntime?.waitForRuntimeSettled?.() ?? Promise.resolve();
	const syncKey = (name: string): string | number => {
		const graph = harness.pageRuntime?.debugDumpGraph?.() as {
			dict?: readonly (string | undefined)[];
		} | null;
		const index = graph?.dict?.indexOf(name) ?? -1;
		return index >= 0 ? index : name;
	};

	const debug: MiniCutDebugBridge = {
		getSnapshot: () => harness.pageRuntime?.getSnapshot() ?? null,
		dumpGraph: () => harness.pageRuntime?.debugDumpGraph?.() ?? null,
		dumpGraphSummary: () =>
			summarizeGraph(harness.pageRuntime?.debugDumpGraph?.() ?? null),
		dumpRuntimeTasks: () => harness.debugDumpRuntimeTasksTesting?.() ?? null,
		dumpProjectState: () => {
			const graph = harness.pageRuntime?.debugDumpGraph?.() as {
				rootNodeId?: unknown;
				dict?: unknown;
				nodes?: unknown;
			} | null;

			if (!graph) {
				return null;
			}

			type GraphNode = {
				nodeId?: unknown;
				id?: unknown;
				_node_id?: unknown;
				modelName?: unknown;
				model_name?: unknown;
				attrs?: unknown;
				rels?: unknown;
			};

			const nodeIdOf = (node: GraphNode | null | undefined): string | null => {
				if (!node) {
					return null;
				}
				const candidate = node.nodeId ?? node.id ?? node._node_id;
				return typeof candidate === "string" ? candidate : null;
			};

			const extractNodeIds = (value: unknown): string[] => {
				if (!value) {
					return [];
				}

				if (typeof value === "string") {
					return [value];
				}

				if (Array.isArray(value)) {
					return value.flatMap((item) => extractNodeIds(item));
				}

				if (typeof value === "object") {
					const obj = value as Record<string, unknown>;
					const directId = obj.nodeId ?? obj.id ?? obj._node_id;
					if (typeof directId === "string") {
						return [directId];
					}

					return Object.values(obj).flatMap((item) => extractNodeIds(item));
				}

				return [];
			};

			const nodes: GraphNode[] = [];
			if (Array.isArray(graph.nodes)) {
				nodes.push(...(graph.nodes as GraphNode[]));
			}

			if (graph.dict && typeof graph.dict === "object") {
				for (const value of Object.values(
					graph.dict as Record<string, unknown>,
				)) {
					if (value && typeof value === "object") {
						nodes.push(value as GraphNode);
					}
				}
			}

			const nodesById = new Map<string, GraphNode>();
			for (const node of nodes) {
				const id = nodeIdOf(node);
				if (id) {
					nodesById.set(id, node);
				}
			}

			const getNode = (id: string | null): GraphNode | null => {
				if (!id) {
					return null;
				}
				return nodesById.get(id) ?? null;
			};

			const getRels = (node: GraphNode | null): Record<string, unknown> => {
				if (!node?.rels || typeof node.rels !== "object") {
					return {};
				}
				return node.rels as Record<string, unknown>;
			};

			const getAttrs = (node: GraphNode | null): Record<string, unknown> => {
				if (!node?.attrs || typeof node.attrs !== "object") {
					return {};
				}
				return node.attrs as Record<string, unknown>;
			};

			const getRelIds = (node: GraphNode | null, relName: string): string[] => {
				const rels = getRels(node);
				return extractNodeIds(rels[relName]);
			};

			const rootNodeId =
				typeof graph.rootNodeId === "string" ? graph.rootNodeId : null;
			const rootNode = getNode(rootNodeId);

			const activeProjectId = getRelIds(rootNode, "activeProject")[0] ?? null;
			const pioneerId = getRelIds(rootNode, "pioneer")[0] ?? null;
			const pioneerNode = getNode(pioneerId);
			const fallbackProjectId = getRelIds(pioneerNode, "project")[0] ?? null;
			const projectNodeId = activeProjectId ?? fallbackProjectId;
			const projectNode = getNode(projectNodeId);

			const trackIds = getRelIds(projectNode, "tracks");
			const tracks = trackIds.map((trackId) => {
				const trackNode = getNode(trackId);
				const clipIds = getRelIds(trackNode, "clips");
				const clips = clipIds.map((clipId) => {
					const clipNode = getNode(clipId);
					return {
						nodeId: clipId,
						model: (clipNode?.modelName ?? clipNode?.model_name ?? null) as
							| string
							| null,
						attrs: getAttrs(clipNode),
					};
				});

				return {
					nodeId: trackId,
					model: (trackNode?.modelName ?? trackNode?.model_name ?? null) as
						| string
						| null,
					attrs: getAttrs(trackNode),
					clipIds,
					clips,
				};
			});

			const resourceIds = getRelIds(projectNode, "resources");
			const resources = resourceIds.map((resourceId) => {
				const resourceNode = getNode(resourceId);
				return {
					nodeId: resourceId,
					model: (resourceNode?.modelName ??
						resourceNode?.model_name ??
						null) as string | null,
					attrs: getAttrs(resourceNode),
				};
			});

			return {
				rootNodeId,
				activeProjectNodeId: activeProjectId,
				projectNodeId,
				projectModel: (projectNode?.modelName ??
					projectNode?.model_name ??
					null) as string | null,
				projectAttrs: getAttrs(projectNode),
				trackIds,
				tracks,
				resourceIds,
				resources,
				nodesCount: nodesById.size,
			};
		},
		getResourceTransfers: () =>
			Object.values(harness.resourceTransfers$.get()).map((transfer) => ({
				resourceId: transfer.resourceId,
				name: transfer.name,
				ownerPeerId: transfer.ownerPeerId,
				status: transfer.status,
				progress: transfer.progress,
				totalBytes: transfer.totalBytes,
				loadedBytes: transfer.loadedBytes,
				previewUrl: transfer.previewUrl,
				loadedRanges: transfer.loadedRanges,
				requestedRanges: transfer.requestedRanges,
				requestedRangesLog: transfer.requestedRangesLog,
				requestEvents: transfer.requestEvents,
				mode: transfer.mode,
				availability: transfer.availability,
				lastError: transfer.lastError,
			})),
		getProjectCount: () => {
			const runtime = harness.pageRuntime;
			const rootScope = runtime?.getRootScope();
			const pioneerScope = rootScope
				? runtime?.readOne(rootScope, "pioneer")
				: null;
			if (!runtime || !pioneerScope) {
				return 0;
			}

			return runtime.readMany(pioneerScope, "project").length;
		},
		getProjectTitles: () => {
			const runtime = harness.pageRuntime;
			const rootScope = runtime?.getRootScope();
			const pioneerScope = rootScope
				? runtime?.readOne(rootScope, "pioneer")
				: null;
			if (!runtime || !pioneerScope) {
				return [];
			}

			return runtime.readMany(pioneerScope, "project").map((scope) => {
				const attrs = runtime.readAttrs(scope, ["title"]) as {
					title?: unknown;
				};
				return typeof attrs.title === "string" ? attrs.title : "Project";
			});
		},
		getActiveProjectTracks: () => {
			const runtime = harness.pageRuntime;
			const projectScope = getActiveProjectScope();
			if (!runtime || !projectScope) {
				return [];
			}

			return runtime.readMany(projectScope, "tracks").map((trackScope) => {
				const trackAttrs = runtime.readAttrs(trackScope, ["name", "kind"]) as {
					name?: unknown;
					kind?: unknown;
				};
				const clipSummaries = runtime
					.readMany(trackScope, "clips")
					.map((clipScope) => {
						const clipAttrs = runtime.readAttrs(clipScope, [
							"name",
							"mediaKind",
						]) as {
							name?: unknown;
							mediaKind?: unknown;
						};
						return {
							name:
								typeof clipAttrs.name === "string" ? clipAttrs.name : "Clip",
							mediaKind:
								typeof clipAttrs.mediaKind === "string"
									? clipAttrs.mediaKind
									: null,
							clipId: clipScope._nodeId ?? null,
						};
					});
				return {
					name: typeof trackAttrs.name === "string" ? trackAttrs.name : "Track",
					kind: typeof trackAttrs.kind === "string" ? trackAttrs.kind : null,
					clips: clipSummaries,
				};
			});
		},
		getActiveProjectPrimaryTracks: () => {
			const runtime = harness.pageRuntime;
			const projectScope = getActiveProjectScope();
			if (!runtime || !projectScope) {
				return null;
			}

			const videoTrack = runtime.readOne(projectScope, "primaryVideoTrack");
			const audioTrack = runtime.readOne(projectScope, "primaryAudioTrack");
			const readTrackName = (
				trackScope: ReturnType<typeof runtime.readOne>,
			) => {
				if (!trackScope) {
					return null;
				}
				const attrs = runtime.readAttrs(trackScope, ["name", "kind"]) as {
					name?: unknown;
					kind?: unknown;
				};
				return {
					name: typeof attrs.name === "string" ? attrs.name : "Track",
					kind: typeof attrs.kind === "string" ? attrs.kind : null,
				};
			};

			return {
				video: readTrackName(videoTrack),
				audio: readTrackName(audioTrack),
			};
		},
		getSelectionState: () => {
			const runtime = harness.pageRuntime;
			const rootScope = runtime?.getRootScope();
			if (!runtime || !rootScope) {
				return null;
			}
			const attrs = runtime.readAttrs(rootScope, [
				"selectedEntityId",
				"selectedClipSummary",
			]) as {
				selectedEntityId?: unknown;
				selectedClipSummary?: unknown;
			};
			const selectedClip = runtime.readOne(rootScope, "selectedClip");
			const clipAttrs = selectedClip
				? (runtime.readAttrs(selectedClip, ["name", "mediaKind"]) as {
						name?: unknown;
						mediaKind?: unknown;
					})
				: null;
			return {
				selectedEntityId:
					typeof attrs.selectedEntityId === "string"
						? attrs.selectedEntityId
						: null,
				selectedClipSummary: attrs.selectedClipSummary ?? null,
				selectedClip: clipAttrs
					? {
							clipId: selectedClip?._nodeId ?? null,
							name: typeof clipAttrs.name === "string" ? clipAttrs.name : null,
							mediaKind:
								typeof clipAttrs.mediaKind === "string"
									? clipAttrs.mediaKind
									: null,
						}
					: null,
			};
		},
		getActiveProjectDetails: () => {
			const runtime = harness.pageRuntime;
			const projectScope = getActiveProjectScope();
			if (!runtime || !projectScope) {
				return null;
			}

			const projectAttrs = runtime.readAttrs(projectScope, [
				"title",
				"duration",
				"timelineDuration",
			]) as {
				title?: unknown;
				duration?: unknown;
				timelineDuration?: unknown;
			};

			const tracks = runtime
				.readMany(projectScope, "tracks")
				.map((trackScope) => {
					const trackAttrs = runtime.readAttrs(trackScope, [
						"name",
						"kind",
						"muted",
						"locked",
						"height",
					]) as {
						name?: unknown;
						kind?: unknown;
						muted?: unknown;
						locked?: unknown;
						height?: unknown;
					};
					const clips = runtime
						.readMany(trackScope, "clips")
						.map((clipScope) => {
							const clipAttrs = runtime.readAttrs(clipScope, [
								"clipRenderData",
								"name",
								"mediaKind",
								"start",
								"in",
								"duration",
							]) as {
								clipRenderData?: unknown;
								name?: unknown;
								mediaKind?: unknown;
								start?: unknown;
								in?: unknown;
								duration?: unknown;
							};
							const clipRenderData =
								clipAttrs.clipRenderData &&
								typeof clipAttrs.clipRenderData === "object"
									? (clipAttrs.clipRenderData as {
											resourceId?: unknown;
											resourceName?: unknown;
										})
									: null;
							return {
								nodeId: clipScope._nodeId,
								clipId: clipScope._nodeId ?? null,
								resourceId:
									typeof clipRenderData?.resourceId === "string"
										? clipRenderData.resourceId
										: null,
								resourceName:
									typeof clipRenderData?.resourceName === "string"
										? clipRenderData.resourceName
										: null,
								name:
									typeof clipAttrs.name === "string" ? clipAttrs.name : "Clip",
								mediaKind:
									typeof clipAttrs.mediaKind === "string"
										? clipAttrs.mediaKind
										: null,
								start:
									typeof clipAttrs.start === "number" ? clipAttrs.start : null,
								in: typeof clipAttrs.in === "number" ? clipAttrs.in : null,
								duration:
									typeof clipAttrs.duration === "number"
										? clipAttrs.duration
										: null,
							};
						});

					return {
						nodeId: trackScope._nodeId,
						name:
							typeof trackAttrs.name === "string" ? trackAttrs.name : "Track",
						kind: typeof trackAttrs.kind === "string" ? trackAttrs.kind : null,
						muted: trackAttrs.muted === true,
						locked: trackAttrs.locked === true,
						height:
							typeof trackAttrs.height === "number" ? trackAttrs.height : null,
						clips,
					};
				});

			const resources = runtime
				.readMany(projectScope, "resources")
				.map((resourceScope) => {
					const resourceAttrs = runtime.readAttrs(resourceScope, [
						"name",
						"kind",
						"duration",
						"status",
					]) as {
						name?: unknown;
						kind?: unknown;
						duration?: unknown;
						status?: unknown;
					};
					return {
						nodeId: resourceScope._nodeId,
						resourceId: resourceScope._nodeId ?? null,
						name:
							typeof resourceAttrs.name === "string"
								? resourceAttrs.name
								: "Resource",
						kind:
							typeof resourceAttrs.kind === "string"
								? resourceAttrs.kind
								: null,
						duration:
							typeof resourceAttrs.duration === "number"
								? resourceAttrs.duration
								: null,
						status:
							typeof resourceAttrs.status === "string"
								? resourceAttrs.status
								: null,
					};
				});

			return {
				nodeId: projectScope._nodeId,
				projectId: projectScope._nodeId ?? null,
				title:
					typeof projectAttrs.title === "string"
						? projectAttrs.title
						: "Project",
				duration:
					typeof projectAttrs.duration === "number"
						? projectAttrs.duration
						: null,
				timelineDuration:
					typeof projectAttrs.timelineDuration === "number"
						? projectAttrs.timelineDuration
						: null,
				tracks,
				resources,
			};
		},
		getRuntimeMessages: () => harness.pageRuntime?.debugMessages?.() ?? [],
		dumpWorkerState: () =>
			harness.pageRuntime?.requestDebugDump?.() ?? Promise.resolve(null),
		getRole: () => {
			const worker = harness.worker as { role?: string };
			return typeof worker.role === "string" ? worker.role : null;
		},
		isRuntimeReady: () => {
			return harness.pageRuntime?.getSnapshot().ready ?? false;
		},
		getPeerId: () => {
			const worker = harness.worker as { peerId?: string };
			return typeof worker.peerId === "string" ? worker.peerId : null;
		},
		createProject: (title?: string) => {
			harness.actions.createProject(title);
		},
		dispatchRootAction: (actionName: string, payload?: unknown) => {
			harness.pageRuntime?.dispatch(actionName, payload, null);
			return waitForRuntimeSettled();
		},
		dispatchProjectAction: (actionName: string, payload?: unknown) => {
			const projectScope = getActiveProjectScope();
			if (!projectScope) {
				throw new Error("No active project");
			}
			harness.pageRuntime?.dispatch(actionName, payload, projectScope);
			return waitForRuntimeSettled();
		},
		injectFirstClipConflictTesting: async (options = {}) => {
			const runtime = harness.pageRuntime;
			const projectScope = getActiveProjectScope();
			if (!runtime || !projectScope) {
				throw new Error("No active project");
			}
			const clipScope =
				runtime.readMany(projectScope, "tracks")
					.flatMap((trackScope) => runtime.readMany(trackScope, "clips"))
					.find((candidate) => {
						const attrs = runtime.readAttrs(candidate, ["mediaKind", "name"]) as {
							mediaKind?: unknown;
							name?: unknown;
						};
						return attrs.mediaKind === "video" || attrs.name === "fixture-video.webm";
					}) ??
				null;
			if (!clipScope?._nodeId) {
				throw new Error("No clip available for conflict injection");
			}
			const timing = options.timing === true;
			const conflictId = `${timing ? "timing" : "structural"}:playwright:${clipScope._nodeId}`;
			const conflictNodeId = `conflict:${conflictId}`;
			const kind = options.kind ?? (timing ? "mvr_alternatives" : "structural_delete_with_concurrent_activity");
			const scope = options.scope ?? (timing ? "clipTiming" : "timelineMembership");
			const summary = options.summary ?? (timing ? "Duration has concurrent edits" : "Remote delete conflicts with local edit");
			const update = [
				0,
				clipScope._nodeId,
				timing ? 4 : 8,
				syncKey("$meta$model$crdt$open_conflicts_count"),
				1,
				...(timing
					? [syncKey("$meta$aggregates$crdt$clipTiming$open_conflicts_count"), 1]
					: [
							syncKey("$meta$aggregates$crdt$timelineMembership$open_conflicts_count"),
							1,
							syncKey("$meta$rels$crdt$clips$open_conflicts_count"),
							1,
							syncKey("$meta$model$crdt$last_conflict_id"),
							conflictId,
						]),
				0,
				conflictNodeId,
				timing ? 10 : 8,
				syncKey("id"),
				conflictId,
				syncKey("kind"),
				kind,
				syncKey("scope"),
				scope,
				syncKey("summary"),
				summary,
				...(timing ? [syncKey("decision"), { start: 0, in: 0, duration: 3 }] : []),
				1,
				clipScope._nodeId,
				syncKey("crdtConflicts"),
				[conflictNodeId],
			];
			runtime.applyDebugSyncUpdateTesting?.(update);
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			runtime.applyDebugSyncUpdateTesting?.(update);
			return { clipId: clipScope._nodeId, conflictId };
		},
		injectFirstClipResolutionErrorTesting: async (options = {}) => {
			const runtime = harness.pageRuntime;
			const projectScope = getActiveProjectScope();
			if (!runtime || !projectScope) {
				throw new Error("No active project");
			}
			const clipScope =
				runtime.readMany(projectScope, "tracks")
					.flatMap((trackScope) => runtime.readMany(trackScope, "clips"))
					.find((candidate) => {
						const attrs = runtime.readAttrs(candidate, ["mediaKind", "name"]) as {
							mediaKind?: unknown;
							name?: unknown;
						};
						return attrs.mediaKind === "video" || attrs.name === "fixture-video.webm";
					}) ??
				null;
			if (!clipScope?._nodeId) {
				throw new Error("No clip available for resolution error injection");
			}
			const update = [
				0,
				clipScope._nodeId,
				2,
				syncKey("$meta$aggregates$crdt$clipTiming$last_resolution_error"),
				{
					code: options.code ?? "duration_non_positive",
					message: options.message ?? "Duration must be greater than 0",
					fields: {
						duration: {
							code: options.fieldCode ?? "duration_must_be_positive",
						},
					},
				},
			];
			runtime.applyDebugSyncUpdateTesting?.(update);
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			runtime.applyDebugSyncUpdateTesting?.(update);
			return { clipId: clipScope._nodeId };
		},
		clearFirstClipConflictTesting: async () => {
			const runtime = harness.pageRuntime;
			const projectScope = getActiveProjectScope();
			if (!runtime || !projectScope) {
				throw new Error("No active project");
			}
			const clipScope =
				runtime.readMany(projectScope, "tracks")
					.flatMap((trackScope) => runtime.readMany(trackScope, "clips"))
					.find((candidate) => {
						const attrs = runtime.readAttrs(candidate, ["mediaKind", "name"]) as {
							mediaKind?: unknown;
							name?: unknown;
						};
						return attrs.mediaKind === "video" || attrs.name === "fixture-video.webm";
					}) ??
				null;
			if (!clipScope?._nodeId) {
				throw new Error("No clip available for conflict clear");
			}
			runtime.applyDebugSyncUpdateTesting?.([
				0,
				clipScope._nodeId,
				6,
				syncKey("$meta$model$crdt$open_conflicts_count"),
				0,
				syncKey("$meta$aggregates$crdt$clipTiming$open_conflicts_count"),
				0,
				syncKey("$meta$aggregates$crdt$clipTiming$last_resolution_error"),
				null,
				1,
				clipScope._nodeId,
				syncKey("crdtConflicts"),
				[],
			]);
			return { clipId: clipScope._nodeId };
		},
		setCursor: (cursor: number) => {
			harness.actions.setCursor(cursor);
		},
		dispatchCreateProject: (title?: string) => {
			harness.actions.createProject(title);
			return waitForRuntimeSettled();
		},
		waitForRuntimeSettled,
	};

	window.__MINICUT_P2P_DEBUG__ = debug;

	return () => {
		if (window.__MINICUT_P2P_DEBUG__ === debug) {
			delete window.__MINICUT_P2P_DEBUG__;
		}
	};
};
