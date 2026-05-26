import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScopeContext } from "../../../dkt-react-sync/context/ScopeContext";
import type { ReactSyncScopeHandle } from "../../../dkt-react-sync/scope/ScopeHandle";
import { useMany } from "../../../dkt-react-sync/hooks/useMany";
import { useOne } from "../../../dkt-react-sync/hooks/useOne";
import { useReactScopeRuntime } from "../../../dkt-react-sync/hooks/useReactScopeRuntime";
import type {
	CrdtConflictStatus,
	MiniCutActivitySummary,
	MiniCutReviewItem,
	MiniCutReviewKind,
	MiniCutReviewObject,
} from "../../dkt/review/types";
import { reviewActionScopeForItem } from "./reviewActionRouting";
import { ReviewPanel } from "./ReviewPanel";

const REVIEW_ITEM_ATTRS = [
	"reviewItemSnapshot",
	"reviewItemId",
	"conflictId",
	"projectId",
	"kind",
	"status",
	"title",
	"affectedObjects",
	"preview",
	"availableActions",
	"actionTargets",
	"source",
] as const;

const REVIEW_SESSION_ATTRS = [
	"reviewSessionId",
	"projectId",
	"selectedReviewItemId",
	"openItemCount",
] as const;

const ACTIVITY_SUMMARY_ATTRS = [
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
	"openedConflictIds",
	"updatedConflictIds",
] as const;

type ReviewSessionView = {
	id: string;
	scope: ReactSyncScopeHandle;
	projectId: string;
	selectedReviewItemId: string | null;
	openItemCount: number;
};

type AttrSnapshot = {
	scope: ReactSyncScopeHandle;
	attrs: Record<string, unknown>;
};

const EMPTY_ATTR_SNAPSHOTS = Object.freeze([]) as readonly AttrSnapshot[];

const asString = (value: unknown, fallback = ""): string =>
	typeof value === "string" && value.length > 0 ? value : fallback;

const asArray = <Value,>(value: unknown): Value[] =>
	Array.isArray(value) ? (value as Value[]) : [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asKind = (value: unknown): MiniCutReviewKind =>
	value === "clip_timing" ||
	value === "dangling_resource" ||
	value === "delete_vs_edit" ||
	value === "track_order" ||
	value === "unknown"
		? value
		: "unknown";

const asStatus = (value: unknown): CrdtConflictStatus =>
	value === "acknowledged" || value === "resolved" ? value : "open";

const toReviewItem = ({ scope, attrs }: AttrSnapshot): MiniCutReviewItem => {
	const snapshot = isRecord(attrs.reviewItemSnapshot)
		? attrs.reviewItemSnapshot
		: attrs;
	const id = asString(snapshot.reviewItemId, asString(snapshot.id, scope._nodeId));
	const conflictId = asString(snapshot.conflictId, id);
	return {
		id,
		conflictId,
		projectId: asString(snapshot.projectId),
		kind: asKind(snapshot.kind),
		status: asStatus(snapshot.status),
		title: asString(snapshot.title, "CRDT conflict"),
		affectedObjects: asArray<MiniCutReviewObject>(snapshot.affectedObjects),
		preview: snapshot.preview ?? null,
		availableActions: asArray<string>(snapshot.availableActions),
		actionTargets: isRecord(snapshot.actionTargets)
			? (snapshot.actionTargets as MiniCutReviewItem["actionTargets"])
			: {},
		source:
			snapshot.source && typeof snapshot.source === "object"
				? (snapshot.source as MiniCutReviewItem["source"])
				: { conflictId },
	};
};

const toReviewSession = ({ scope, attrs }: AttrSnapshot): ReviewSessionView => ({
	id: asString(attrs.reviewSessionId, scope._nodeId),
	scope,
	projectId: asString(attrs.projectId),
	selectedReviewItemId:
		typeof attrs.selectedReviewItemId === "string" &&
		attrs.selectedReviewItemId.length > 0
			? attrs.selectedReviewItemId
			: null,
	openItemCount:
		typeof attrs.openItemCount === "number" && Number.isFinite(attrs.openItemCount)
			? attrs.openItemCount
			: 0,
});

const toActivitySummary = ({
	scope,
	attrs,
}: AttrSnapshot): MiniCutActivitySummary => ({
	id: asString(attrs.activitySummaryId, scope._nodeId),
	projectId: asString(attrs.projectId),
	batchId: asString(attrs.batchId),
	originPeerId: asString(attrs.originPeerId),
	title: asString(attrs.title, "Project changes"),
	created: asArray<MiniCutReviewObject>(attrs.created),
	updated: asArray<MiniCutReviewObject>(attrs.updated),
	deleted: asArray<MiniCutReviewObject>(attrs.deleted),
	rootFrames: asArray<{ frameId: number; opCount: number; createCount: number }>(
		attrs.rootFrames,
	),
	happenedAt:
		typeof attrs.happenedAt === "number" && Number.isFinite(attrs.happenedAt)
			? attrs.happenedAt
			: 0,
	openedConflictIds: asArray<string>(attrs.openedConflictIds),
	updatedConflictIds: asArray<string>(attrs.updatedConflictIds),
});

const sameAttrSnapshots = (
	left: readonly AttrSnapshot[],
	right: readonly AttrSnapshot[],
	attrNames: readonly string[],
) => {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		const leftItem = left[index];
		const rightItem = right[index];
		if (leftItem.scope._nodeId !== rightItem.scope._nodeId) return false;
		for (const name of attrNames) {
			if (!Object.is(leftItem.attrs[name], rightItem.attrs[name])) {
				return false;
			}
		}
	}
	return true;
};

const useRelAttrSnapshots = (
	scope: ReactSyncScopeHandle | null,
	relName: string,
	attrNames: readonly string[],
): readonly AttrSnapshot[] => {
	const runtime = useReactScopeRuntime();
	const cacheRef = useRef<readonly AttrSnapshot[]>(EMPTY_ATTR_SNAPSHOTS);

	const getSnapshot = useCallback(() => {
		if (!scope) {
			cacheRef.current = EMPTY_ATTR_SNAPSHOTS;
			return cacheRef.current;
		}
		const scopes = runtime.readMany(scope, relName);
		const next = scopes.map((itemScope) => ({
			scope: itemScope,
			attrs: runtime.readAttrs(itemScope, attrNames),
		}));
		if (sameAttrSnapshots(cacheRef.current, next, attrNames)) {
			return cacheRef.current;
		}
		cacheRef.current = next;
		return next;
	}, [runtime, scope, relName, attrNames]);

	return useSyncExternalStore(
		(listener) => {
			if (!scope) return () => {};
			let cleanAttrSubs: Array<() => void> = [];
			const resubscribeAttrs = () => {
				for (const cleanup of cleanAttrSubs) cleanup();
				cleanAttrSubs = runtime
					.readMany(scope, relName)
					.map((itemScope) =>
						runtime.subscribeAttrs(itemScope, attrNames, listener),
					);
			};
			resubscribeAttrs();
			const cleanRel = runtime.subscribeMany(scope, relName, () => {
				resubscribeAttrs();
				listener();
			});
			return () => {
				cleanRel();
				for (const cleanup of cleanAttrSubs) cleanup();
			};
		},
		getSnapshot,
		getSnapshot,
	);
};

export const ProjectReviewMode = () => {
	const activeProjectScope = useOne("activeProject");

	if (!activeProjectScope) {
		return null;
	}

	return (
		<ScopeContext.Provider value={activeProjectScope}>
			<ProjectReviewContent projectScope={activeProjectScope} />
		</ScopeContext.Provider>
	);
};

const ProjectReviewContent = ({
	projectScope,
}: {
	projectScope: ReactSyncScopeHandle;
}) => {
	const runtime = useReactScopeRuntime();
	const reviewItemScopes = useMany("reviewItems");
	const reviewSessionScopes = useMany("reviewSessions");
	const itemSnapshots = useRelAttrSnapshots(
		projectScope,
		"reviewItems",
		REVIEW_ITEM_ATTRS,
	);
	const sessionSnapshots = useRelAttrSnapshots(
		projectScope,
		"reviewSessions",
		REVIEW_SESSION_ATTRS,
	);
	const [isOpen, setIsOpen] = useState(false);
	const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
	const items = useMemo(
		() => itemSnapshots.map(toReviewItem),
		[itemSnapshots],
	);
	const sessions = useMemo(
		() => sessionSnapshots.map(toReviewSession),
		[sessionSnapshots],
	);
	const openCount = useMemo(
		() => items.filter((item) => item.status === "open").length,
		[items],
	);
	const session =
		sessions.find((candidate) => candidate.openItemCount > 0) ??
		sessions[0] ??
		null;
	const activitySnapshots = useRelAttrSnapshots(
		session?.scope ?? null,
		"activitySummaries",
		ACTIVITY_SUMMARY_ATTRS,
	);
	const activitySummaries = useMemo(
		() => activitySnapshots.map(toActivitySummary),
		[activitySnapshots],
	);

	useEffect(() => {
		if (openCount > 0) {
			setIsOpen(true);
		}
	}, [openCount]);

	useEffect(() => {
		setSelectedItemId(session?.selectedReviewItemId ?? items[0]?.id ?? null);
	}, [session?.id, session?.selectedReviewItemId, items]);

	if (
		reviewItemScopes.length === 0 &&
		reviewSessionScopes.length === 0 &&
		activitySummaries.length === 0
	) {
		return null;
	}

	if (items.length === 0 && activitySummaries.length === 0) {
		return null;
	}

	return (
		<>
			<button
				type="button"
				className="ve-project-review-trigger"
				aria-label={openCount > 0 ? `Review ${openCount}` : "Review"}
				onClick={() => setIsOpen(true)}
			>
				Review
				{openCount > 0 ? <span> {openCount}</span> : null}
			</button>
			{isOpen ? (
				<div className="ve-project-review-drawer">
					<ReviewPanel
						items={items}
						activitySummaries={activitySummaries}
						selectedItemId={selectedItemId ?? session?.selectedReviewItemId}
						onSelectReviewItem={(item) => setSelectedItemId(item.id)}
						onClose={() => setIsOpen(false)}
						onAcknowledgeReviewItem={(item) =>
							runtime.dispatch(
								"acknowledgeReviewItem",
								{
									conflict_id: item.conflictId,
									review_item_id: item.id,
								},
								null,
							)
						}
						onReviewAction={(actionId, item, payload) => {
							const actionScope = reviewActionScopeForItem(item, actionId);
							if (!actionScope) return;
							runtime.dispatch(
								actionId,
								{
									conflict_id: item.conflictId,
									review_item_id: item.id,
									...(isRecord(payload) ? payload : {}),
								},
								actionScope,
							);
						}}
					/>
				</div>
			) : null}
		</>
	);
};
