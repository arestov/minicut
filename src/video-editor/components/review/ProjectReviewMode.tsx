import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScopeContext } from "../../../dkt-react-sync/context/ScopeContext";
import { useAttrs } from "../../../dkt-react-sync/hooks/useAttrs";
import { useMany } from "../../../dkt-react-sync/hooks/useMany";
import { useReactScopeRuntime } from "../../../dkt-react-sync/hooks/useReactScopeRuntime";
import { useRootOne } from "../../../dkt-react-sync/hooks/useRootOne";
import { useScope } from "../../../dkt-react-sync/hooks/useScope";
import type { ReactSyncScopeHandle } from "../../../dkt-react-sync/scope/ScopeHandle";
import type {
	CrdtConflictStatus,
	MiniCutActivitySummary,
	MiniCutReviewItem,
	MiniCutReviewKind,
	MiniCutReviewObject,
} from "../../dkt/review/types";
import { ReviewPanel } from "./ReviewPanel";

type ReviewSessionSnapshot = {
	id: string;
	selectedReviewItemId: string | null;
	items: MiniCutReviewItem[];
	activitySummaries: MiniCutActivitySummary[];
};

type ObservedClipConflict = {
	conflictId: string;
	clipId: string;
	projectId: string;
};

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const asStatus = (value: unknown): CrdtConflictStatus =>
	value === "acknowledged" || value === "resolved" ? value : "open";

const asKind = (value: unknown): MiniCutReviewKind => {
	if (
		value === "clip_timing" ||
		value === "dangling_resource" ||
		value === "delete_vs_edit" ||
		value === "track_order" ||
		value === "unknown"
	) {
		return value;
	}
	return "unknown";
};

const asArray = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value as Value[]) : [];

const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const useRuntimeMany = (
	scope: ReactSyncScopeHandle | null,
	relName: string,
): ReactSyncScopeHandle[] => {
	const runtime = useReactScopeRuntime();
	return useSyncExternalStore(
		(listener) =>
			scope ? runtime.subscribeMany(scope, relName, listener) : () => {},
		() => (scope ? (runtime.readMany(scope, relName) as ReactSyncScopeHandle[]) : []),
		() => (scope ? (runtime.readMany(scope, relName) as ReactSyncScopeHandle[]) : []),
	);
};

const reviewItemFromObservedConflict = ({
	conflictId,
	clipId,
	projectId,
}: ObservedClipConflict): MiniCutReviewItem => ({
	id: `review:${conflictId}`,
	conflictId,
	projectId,
	kind: "clip_timing",
	status: "open",
	title: "Clip timing conflict",
	affectedObjects: [{ type: "clip", id: clipId }],
	preview: {
		type: "clip_timing",
		conflictId,
		payload: null,
		details: null,
		variants: null,
	},
	availableActions: [
		"resolveClipTimingConflict",
		"parkIncomingVariantOnReviewTrack",
	],
	source: { conflictId },
});

const ClipCrdtReviewReader = ({
	scopeId,
	onConflict,
}: {
	scopeId: string;
	onConflict: (conflict: ObservedClipConflict) => void;
}) => {
	const attrs = useAttrs([
		"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
		"$meta$aggregates$crdt$clipTiming$last_conflict_id",
	]) as Record<string, unknown>;
	const openCount =
		typeof attrs["$meta$aggregates$crdt$clipTiming$open_conflicts_count"] ===
			"number"
			? attrs["$meta$aggregates$crdt$clipTiming$open_conflicts_count"]
			: 0;
	const conflictId = asString(
		attrs["$meta$aggregates$crdt$clipTiming$last_conflict_id"],
	);

	useEffect(() => {
		if (openCount <= 0 || !conflictId) {
			return;
		}
		onConflict({ conflictId, clipId: scopeId });
	}, [conflictId, onConflict, openCount, scopeId]);

	return null;
};

const ProjectCrdtReviewProjectionInner = ({
	onConflict,
}: {
	onConflict: (conflict: ObservedClipConflict) => void;
}) => {
	const clipScopes = useMany("clip") as ReactSyncScopeHandle[];
	return (
		<>
			{clipScopes.map((scope) => (
				<ScopeContext.Provider key={scope._nodeId} value={scope}>
					<ClipCrdtReviewReader
						scopeId={scope._nodeId}
						onConflict={onConflict}
					/>
				</ScopeContext.Provider>
			))}
		</>
	);
};

const ActiveProjectCrdtReviewProjectionInner = ({
	onConflict,
}: {
	onConflict: (conflict: ObservedClipConflict) => void;
}) => {
	const trackScopes = useMany("tracks") as ReactSyncScopeHandle[];
	return (
		<>
			{trackScopes.map((trackScope) => (
				<ScopeContext.Provider key={trackScope._nodeId} value={trackScope}>
					<ActiveTrackCrdtReviewProjectionInner onConflict={onConflict} />
				</ScopeContext.Provider>
			))}
		</>
	);
};

const ActiveTrackCrdtReviewProjectionInner = ({
	onConflict,
}: {
	onConflict: (conflict: ObservedClipConflict) => void;
}) => {
	const clipScopes = useMany("clips") as ReactSyncScopeHandle[];
	return (
		<>
			{clipScopes.map((scope) => (
				<ScopeContext.Provider key={scope._nodeId} value={scope}>
					<ClipCrdtReviewReader
						scopeId={scope._nodeId}
						onConflict={onConflict}
					/>
				</ScopeContext.Provider>
			))}
		</>
	);
};

const ProjectCrdtReviewProjectionBridge = ({
	appRootScope,
	onObservedConflict,
}: {
	appRootScope: ReactSyncScopeHandle;
	onObservedConflict: (conflict: ObservedClipConflict) => void;
}) => {
	const runtime = useReactScopeRuntime();
	const sessionScope = useScope();
	const projectedConflictIds = useRef(new Set<string>());
	const activeProjectScope = useSyncExternalStore(
		(listener) =>
			sessionScope
				? runtime.subscribeOne(sessionScope, "activeProject", listener)
				: () => {},
		() =>
			sessionScope ? runtime.readOne(sessionScope, "activeProject") : null,
		() =>
			sessionScope ? runtime.readOne(sessionScope, "activeProject") : null,
	);
	const activeProjectId =
		activeProjectScope && typeof activeProjectScope._nodeId === "string"
			? activeProjectScope._nodeId
			: null;

	useEffect(() => {
		runtime.dispatchAction("setActiveProjectHint", activeProjectId, appRootScope);
	}, [runtime, appRootScope, activeProjectId]);

	if (!activeProjectScope || !activeProjectId) {
		return null;
	}

	return (
		<>
			<ScopeContext.Provider value={appRootScope}>
				<ProjectCrdtReviewProjectionInner
					onConflict={({ conflictId, clipId }) => {
						if (projectedConflictIds.current.has(conflictId)) {
							return;
						}
						projectedConflictIds.current.add(conflictId);
						onObservedConflict({ conflictId, clipId, projectId: activeProjectId });
						runtime.dispatchAction(
							"handleCRDTConflict",
							{
								event_type: "crdt_conflict",
								projectId: activeProjectId,
								happened_at: Date.now(),
								opened: [
									{
										conflict_id: conflictId,
										status: "open",
										kind: "mvr_alternatives",
										node_id: clipId,
										model_name: "clip",
										field_kind: "attr",
										field_name: "start",
										aggregate: "clipTiming",
										happened_at: Date.now(),
									},
								],
								updated: [],
								acknowledged: [],
								resolved: [],
								previous: {},
							},
							appRootScope,
						);
					}}
				/>
			</ScopeContext.Provider>
			<ScopeContext.Provider value={activeProjectScope}>
				<ActiveProjectCrdtReviewProjectionInner
					onConflict={({ conflictId, clipId }) => {
					if (projectedConflictIds.current.has(conflictId)) {
						return;
					}
					projectedConflictIds.current.add(conflictId);
					onObservedConflict({ conflictId, clipId, projectId: activeProjectId });
					runtime.dispatchAction(
						"handleCRDTConflict",
						{
							event_type: "crdt_conflict",
							projectId: activeProjectId,
							happened_at: Date.now(),
							opened: [
								{
									conflict_id: conflictId,
									status: "open",
									kind: "mvr_alternatives",
									node_id: clipId,
									model_name: "clip",
									field_kind: "attr",
									field_name: "start",
									aggregate: "clipTiming",
									happened_at: Date.now(),
								},
							],
							updated: [],
							acknowledged: [],
							resolved: [],
							previous: {},
						},
						appRootScope,
					);
				}}
				/>
			</ScopeContext.Provider>
		</>
	);
};

const ReviewItemReader = ({
	scope,
	onRead,
}: {
	scope: ReactSyncScopeHandle;
	onRead: (scopeId: string, item: MiniCutReviewItem) => void;
}) => (
	<ScopeContext.Provider value={scope}>
		<ReviewItemReaderInner scopeId={scope._nodeId} onRead={onRead} />
	</ScopeContext.Provider>
);

const ReviewItemReaderInner = ({
	scopeId,
	onRead,
}: {
	scopeId: string;
	onRead: (scopeId: string, item: MiniCutReviewItem) => void;
}) => {
	const attrs = useAttrs([
		"reviewItemId",
		"conflictId",
		"projectId",
		"kind",
		"status",
		"title",
		"affectedObjects",
		"preview",
		"availableActions",
		"source",
	]) as Record<string, unknown>;
	const item = useMemo<MiniCutReviewItem>(
		() => ({
			id: asString(attrs.reviewItemId) ?? scopeId,
			conflictId: asString(attrs.conflictId) ?? scopeId,
			projectId: asString(attrs.projectId) ?? "",
			kind: asKind(attrs.kind),
			status: asStatus(attrs.status),
			title: asString(attrs.title) ?? "CRDT conflict",
			affectedObjects: asArray<MiniCutReviewObject>(attrs.affectedObjects),
			preview: attrs.preview ?? null,
			availableActions: asArray<string>(attrs.availableActions),
			source:
				attrs.source && typeof attrs.source === "object"
					? (attrs.source as MiniCutReviewItem["source"])
					: { conflictId: asString(attrs.conflictId) ?? scopeId },
		}),
		[attrs, scopeId],
	);
	useEffect(() => {
		onRead(scopeId, item);
	}, [scopeId, item, onRead]);
	return null;
};

const ActivitySummaryReader = ({
	scope,
	onRead,
}: {
	scope: ReactSyncScopeHandle;
	onRead: (scopeId: string, summary: MiniCutActivitySummary) => void;
}) => (
	<ScopeContext.Provider value={scope}>
		<ActivitySummaryReaderInner scopeId={scope._nodeId} onRead={onRead} />
	</ScopeContext.Provider>
);

const ActivitySummaryReaderInner = ({
	scopeId,
	onRead,
}: {
	scopeId: string;
	onRead: (scopeId: string, summary: MiniCutActivitySummary) => void;
}) => {
	const attrs = useAttrs([
		"activitySummaryId",
		"projectId",
		"batchId",
		"originPeerId",
		"title",
		"created",
		"updated",
		"deleted",
		"rootFrames",
		"happenedAt",
	]) as Record<string, unknown>;
	const summary = useMemo<MiniCutActivitySummary>(
		() => ({
			id: asString(attrs.activitySummaryId) ?? scopeId,
			projectId: asString(attrs.projectId) ?? "",
			batchId: asString(attrs.batchId) ?? "",
			originPeerId: asString(attrs.originPeerId) ?? "",
			title: asString(attrs.title) ?? "Project changes",
			created: asArray<MiniCutReviewObject>(attrs.created),
			updated: asArray<MiniCutReviewObject>(attrs.updated),
			deleted: asArray<MiniCutReviewObject>(attrs.deleted),
			rootFrames: asArray(attrs.rootFrames),
			happenedAt:
				typeof attrs.happenedAt === "number" ? attrs.happenedAt : 0,
		}),
		[attrs, scopeId],
	);
	useEffect(() => {
		onRead(scopeId, summary);
	}, [scopeId, summary, onRead]);
	return null;
};

const ReviewSessionReader = ({
	scope,
	onRead,
}: {
	scope: ReactSyncScopeHandle;
	onRead: (snapshot: ReviewSessionSnapshot) => void;
}) => (
	<ScopeContext.Provider value={scope}>
		<ReviewSessionReaderInner scopeId={scope._nodeId} onRead={onRead} />
	</ScopeContext.Provider>
);

const ReviewSessionReaderInner = ({
	scopeId,
	onRead,
}: {
	scopeId: string;
	onRead: (snapshot: ReviewSessionSnapshot) => void;
}) => {
	const attrs = useAttrs(["reviewSessionId", "selectedReviewItemId"]) as Record<
		string,
		unknown
	>;
	const scope = useScope();
	const itemScopes = useRuntimeMany(scope, "items");
	const activityScopes = useRuntimeMany(scope, "activitySummaries");
	const [itemsByScope, setItemsByScope] = useState<
		Record<string, MiniCutReviewItem>
	>({});
	const [summariesByScope, setSummariesByScope] = useState<
		Record<string, MiniCutActivitySummary>
	>({});
	const itemScopeIds = useMemo(
		() => new Set(itemScopes.map((scope) => scope._nodeId)),
		[itemScopes],
	);
	const activityScopeIds = useMemo(
		() => new Set(activityScopes.map((scope) => scope._nodeId)),
		[activityScopes],
	);

	useEffect(() => {
		setItemsByScope((current) =>
			Object.fromEntries(
				Object.entries(current).filter(([scopeId]) => itemScopeIds.has(scopeId)),
			),
		);
	}, [itemScopeIds]);

	useEffect(() => {
		setSummariesByScope((current) =>
			Object.fromEntries(
				Object.entries(current).filter(([scopeId]) =>
					activityScopeIds.has(scopeId),
				),
			),
		);
	}, [activityScopeIds]);

	const snapshot = useMemo<ReviewSessionSnapshot>(
		() => ({
			id: asString(attrs.reviewSessionId) ?? scopeId,
			selectedReviewItemId: asString(attrs.selectedReviewItemId),
			items: itemScopes.flatMap((scope) => itemsByScope[scope._nodeId] ?? []),
			activitySummaries: activityScopes.flatMap(
				(scope) => summariesByScope[scope._nodeId] ?? [],
			),
		}),
		[
			attrs,
			scopeId,
			itemScopes,
			activityScopes,
			itemsByScope,
			summariesByScope,
		],
	);

	useEffect(() => {
		onRead(snapshot);
	}, [snapshot, onRead]);

	return (
		<>
			{itemScopes.map((scope) => (
				<ReviewItemReader
					key={scope._nodeId}
					scope={scope}
					onRead={(itemScopeId, item) =>
						setItemsByScope((current) =>
							sameJson(current[itemScopeId], item)
								? current
								: { ...current, [itemScopeId]: item },
						)
					}
				/>
			))}
			{activityScopes.map((scope) => (
				<ActivitySummaryReader
					key={scope._nodeId}
					scope={scope}
					onRead={(summaryScopeId, summary) =>
						setSummariesByScope((current) =>
							sameJson(current[summaryScopeId], summary)
								? current
								: { ...current, [summaryScopeId]: summary },
						)
					}
				/>
			))}
		</>
	);
};

const AppRootReviewMode = ({
	projectedItems,
}: {
	projectedItems: MiniCutReviewItem[];
}) => {
	const runtime = useReactScopeRuntime();
	const appRootScope = useScope();
	const sessionScopes = useRuntimeMany(appRootScope, "reviewSession");
	const [isOpen, setIsOpen] = useState(false);
	const [sessionsById, setSessionsById] = useState<
		Record<string, ReviewSessionSnapshot>
	>({});
	const sessions = useMemo(
		() =>
			sessionScopes
				.map((scope) => sessionsById[scope._nodeId])
				.filter((session): session is ReviewSessionSnapshot => Boolean(session)),
		[sessionScopes, sessionsById],
	);
	const currentSession =
		sessions.find((session) => session.items.some((item) => item.status !== "resolved")) ??
		(projectedItems.length > 0
			? {
					id: "projected-crdt-review",
					selectedReviewItemId: projectedItems[0]?.id ?? null,
					items: projectedItems,
					activitySummaries: [],
				}
			: null) ??
		sessions[0] ??
		null;
	const openCount =
		currentSession?.items.filter((item) => item.status !== "resolved").length ?? 0;

	useEffect(() => {
		if (openCount > 0) {
			setIsOpen(true);
		}
	}, [openCount]);

	if (sessionScopes.length === 0 && projectedItems.length === 0 && !currentSession) {
		return null;
	}

	return (
		<>
			{sessionScopes.map((scope) => (
				<ReviewSessionReader
					key={scope._nodeId}
					scope={scope}
					onRead={(snapshot) =>
						setSessionsById((current) =>
							sameJson(current[scope._nodeId], snapshot)
								? current
								: { ...current, [scope._nodeId]: snapshot },
						)
					}
				/>
			))}
			<button
				type="button"
				className="ve-project-review-trigger"
				onClick={() => setIsOpen(true)}
			>
				Review
				{openCount > 0 ? <span>{openCount}</span> : null}
			</button>
			{isOpen && currentSession ? (
				<div className="ve-project-review-drawer">
					<ReviewPanel
						items={currentSession.items}
						activitySummaries={currentSession.activitySummaries}
						selectedItemId={currentSession.selectedReviewItemId}
						onClose={() => setIsOpen(false)}
						onAcknowledgeReviewItem={(item) =>
							runtime.dispatchAction("acknowledgeReviewItem", {
								conflict_id: item.conflictId,
								review_item_id: item.id,
							})
						}
						onReviewAction={(actionId, item) => {
							const affectedClip = item.affectedObjects.find(
								(object) => object.type === "clip",
							);
							runtime.dispatchAction(
								actionId,
								{
									conflict_id: item.conflictId,
									review_item_id: item.id,
								},
								affectedClip
									? { kind: "scope", _nodeId: affectedClip.id }
									: null,
							);
						}}
					/>
				</div>
			) : null}
		</>
	);
};

export const ProjectReviewMode = () => {
	const appRootScope = useRootOne("pioneer");
	const [projectedItemsByConflict, setProjectedItemsByConflict] = useState<
		Record<string, MiniCutReviewItem>
	>({});
	const projectedItems = useMemo(
		() => Object.values(projectedItemsByConflict),
		[projectedItemsByConflict],
	);
	useEffect(() => {
		const handleReviewItems = (event: Event) => {
			const items = (event as CustomEvent<{ items?: unknown }>).detail?.items;
			if (!Array.isArray(items)) {
				return;
			}
			setProjectedItemsByConflict((current) => {
				let next = current;
				for (const item of items as MiniCutReviewItem[]) {
					if (!item?.conflictId || next[item.conflictId]) {
						continue;
					}
					next =
						next === current
							? { ...current, [item.conflictId]: item }
							: { ...next, [item.conflictId]: item };
				}
				return next;
			});
		};
		window.addEventListener("minicut:crdt-review-items", handleReviewItems);
		return () =>
			window.removeEventListener("minicut:crdt-review-items", handleReviewItems);
	}, []);
	if (!appRootScope) {
		return null;
	}
	return (
		<>
			<ProjectCrdtReviewProjectionBridge
				appRootScope={appRootScope}
				onObservedConflict={(conflict) =>
					setProjectedItemsByConflict((current) => {
						if (current[conflict.conflictId]) {
							return current;
						}
						return {
							...current,
							[conflict.conflictId]: reviewItemFromObservedConflict(conflict),
						};
					})
				}
			/>
			<ScopeContext.Provider value={appRootScope}>
				<AppRootReviewMode projectedItems={projectedItems} />
			</ScopeContext.Provider>
		</>
	);
};
