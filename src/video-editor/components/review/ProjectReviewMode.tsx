import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScopeContext } from "../../../dkt-react-sync/context/ScopeContext";
import { useAttrs } from "../../../dkt-react-sync/hooks/useAttrs";
import { useReactScopeRuntime } from "../../../dkt-react-sync/hooks/useReactScopeRuntime";
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
	projectId: string;
	selectedReviewItemId: string | null;
	items: MiniCutReviewItem[];
	activitySummaries: MiniCutActivitySummary[];
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
	const attrs = useAttrs([
		"reviewSessionId",
		"projectId",
		"selectedReviewItemId",
	]) as Record<string, unknown>;
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
			projectId: asString(attrs.projectId) ?? "",
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

const ProjectReviewModeInner = () => {
	const runtime = useReactScopeRuntime();
	const projectScope = useScope();
	const sessionScopes = useRuntimeMany(projectScope, "reviewSessions");
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
		sessions[0] ??
		null;
	const openCount =
		currentSession?.items.filter((item) => item.status !== "resolved").length ?? 0;

	useEffect(() => {
		if (openCount > 0) {
			setIsOpen(true);
		}
	}, [openCount]);

	if (
		!currentSession ||
		(currentSession.items.length === 0 &&
			currentSession.activitySummaries.length === 0)
	) {
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
				aria-label={openCount > 0 ? `Review ${openCount}` : "Review"}
				onClick={() => setIsOpen(true)}
			>
				Review
				{openCount > 0 ? <span> {openCount}</span> : null}
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
	const runtime = useReactScopeRuntime();
	const sessionScope = useScope();
	const projectScope = useSyncExternalStore(
		(listener) =>
			sessionScope
				? runtime.subscribeOne(sessionScope, "activeProject", listener)
				: () => {},
		() =>
			sessionScope ? runtime.readOne(sessionScope, "activeProject") : null,
		() =>
			sessionScope ? runtime.readOne(sessionScope, "activeProject") : null,
	);
	if (!projectScope) {
		return null;
	}
	return (
		<ScopeContext.Provider value={projectScope}>
			<ProjectReviewModeInner />
		</ScopeContext.Provider>
	);
};
