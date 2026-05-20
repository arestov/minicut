import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { useActions } from "../../dkt-react-sync/hooks/useActions";
import { useAttrs } from "../../dkt-react-sync/hooks/useAttrs";
import { useMany } from "../../dkt-react-sync/hooks/useMany";
import { useOne } from "../../dkt-react-sync/hooks/useOne";
import { useReactScopeRuntime } from "../../dkt-react-sync/hooks/useReactScopeRuntime";
import { useRootDispatch } from "../../dkt-react-sync/hooks/useRootDispatch";
import { getAttrsShape } from "../../dkt-react-sync/shape/autoShapes";
import { useShape } from "../../dkt-react-sync/hooks/useShape";
import type { ReactSyncScopeHandle } from "../../dkt-react-sync/scope/ScopeHandle";
import type { AnimatedScalar } from "../render/registryTypes";
import { ClipConflictBadge } from "./ClipConflictBadge";
import {
	ConflictInspectorPanel,
	type ClipConflictItem,
} from "./ConflictInspectorPanel";
import { formatPercent, formatSeconds } from "./format";

const MIN_CLIP_DURATION = 0.5;
let nextClipGestureIntentId = 0;

const clamp = (value: number, min: number, max: number): number => {
	const safeMax = Math.max(min, max);
	return Math.min(safeMax, Math.max(min, value));
};

type ClipTimelineAttrs = {
	start: number;
	in: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
};

type ClipPointerDragState =
	| {
			kind: "move";
			startX: number;
			lastClientX: number;
			batchId: string;
			original: ClipTimelineAttrs;
			current: ClipTimelineAttrs;
	  }
	| {
			kind: "resize-start" | "resize-end";
			startX: number;
			lastClientX: number;
			batchId: string;
			original: ClipTimelineAttrs;
			current: ClipTimelineAttrs;
	  };

interface ClipItemProps {
	timelineZoom: number;
	activeTool: "select" | "trim" | "split" | "hand";
	selectedEntityId: string | null;
}

interface ClipRenderAttrs {
	name?: unknown;
	start?: unknown;
	duration?: unknown;
	in?: unknown;
	opacity?: AnimatedScalar;
	color?: unknown;
	"$meta$aggregates$crdt$clipTiming$open_conflicts_count"?: unknown;
	"$meta$aggregates$crdt$clipTiming$last_resolution_error"?: unknown;
	"$meta$aggregates$crdt$timelineMembership$open_conflicts_count"?: unknown;
	"$meta$rels$crdt$clips$open_conflicts_count"?: unknown;
	"$meta$model$crdt$open_conflicts_count"?: unknown;
	"$meta$model$crdt$last_resolution_error"?: unknown;
}

interface ResourceRenderAttrs {
	duration?: unknown;
}

const EMPTY_ATTRS = Object.freeze({}) as Record<string, unknown>;

const normalizeFields = (fields: readonly string[]) =>
	Array.from(new Set(fields)).sort();

const useScopeAttrs = (
	scope: ReactSyncScopeHandle | null,
	fields: readonly string[],
) => {
	const runtime = useReactScopeRuntime();
	const normalizedFields = useMemo(() => normalizeFields(fields), [fields]);
	useShape(getAttrsShape(normalizedFields));
	const subscribe = useCallback(
		(listener: () => void) =>
			scope ? runtime.subscribeAttrs(scope, normalizedFields, listener) : () => {},
		[runtime, scope, normalizedFields],
	);
	const getSnapshot = useCallback(
		() =>
			scope ? runtime.readAttrs(scope, normalizedFields) : EMPTY_ATTRS,
		[runtime, scope, normalizedFields],
	);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const getClipResizeDeltaSecondsForUi = (
	edge: "start" | "end",
	deltaSeconds: number,
	base: Pick<ClipTimelineAttrs, "start" | "in" | "duration">,
	sourceDuration: number | null,
): number => {
	const clipEnd = base.start + base.duration;
	const maxDuration =
		typeof sourceDuration === "number" && Number.isFinite(sourceDuration)
			? Math.max(MIN_CLIP_DURATION, sourceDuration - base.in)
			: Number.POSITIVE_INFINITY;

	if (edge === "end") {
		const nextEnd = clamp(
			clipEnd + deltaSeconds,
			base.start + MIN_CLIP_DURATION,
			base.start + maxDuration,
		);
		return Math.round((nextEnd - clipEnd) * 100) / 100;
	}

	const minStart = Math.max(0, base.start - base.in);
	const nextStart = clamp(
		base.start + deltaSeconds,
		minStart,
		clipEnd - MIN_CLIP_DURATION,
	);
	return Math.round((nextStart - base.start) * 100) / 100;
};

interface ConflictViewAttrs {
	id?: unknown;
	kind?: unknown;
	scope?: unknown;
	summary?: unknown;
	decision?: unknown;
}

const ClipGradeBadge = () => {
	const attrs = useAttrs(["kind", "enabled"]) as {
		kind?: unknown;
		enabled?: unknown;
	};

	return attrs.kind === "color-correction" && attrs.enabled !== false ? (
		<span className="ve-clip__badge">Grade</span>
	) : null;
};

const isTimingDecision = (
	value: unknown,
): value is NonNullable<ClipConflictItem["decision"]> => {
	if (!value || typeof value !== "object") {
		return false;
	}
	const decision = value as { start?: unknown; in?: unknown; duration?: unknown };
	return (
		typeof decision.start === "number" ||
		typeof decision.in === "number" ||
		typeof decision.duration === "number"
	);
};

const sameConflictItem = (
	left: ClipConflictItem | undefined,
	right: ClipConflictItem,
): boolean =>
	Boolean(left) &&
	left?.id === right.id &&
	left?.kind === right.kind &&
	left?.scope === right.scope &&
	left?.summary === right.summary &&
	left?.decision === right.decision;

const ClipConflictProjectionItem = ({
	scope,
	onRead,
}: {
	scope: { _nodeId: string };
	onRead: (item: ClipConflictItem) => void;
}) => {
	const attrs = useAttrs(["id", "kind", "scope", "summary", "decision"]) as
		ConflictViewAttrs;
	const item = {
		id: typeof attrs.id === "string" ? attrs.id : scope._nodeId,
		kind: typeof attrs.kind === "string" ? attrs.kind : undefined,
		scope: typeof attrs.scope === "string" ? attrs.scope : undefined,
		summary: typeof attrs.summary === "string" ? attrs.summary : undefined,
		decision: isTimingDecision(attrs.decision) ? attrs.decision : undefined,
	};
	useEffect(() => {
		onRead(item);
	}, [item.id, item.kind, item.scope, item.summary, item.decision, onRead]);
	return null;
};

const createClipTimingBatchId = (clipId: string | null): string => {
	nextClipGestureIntentId += 1;
	return `clip-timing:${clipId ?? "unknown"}:${nextClipGestureIntentId}`;
};

export const ClipItem = ({
	timelineZoom,
	activeTool,
	selectedEntityId,
}: ClipItemProps) => {
	const dragState = useRef<ClipPointerDragState | null>(null);
	const [dragPreviewDeltaPx, setDragPreviewDeltaPx] = useState(0);
	const [isConflictInspectorOpen, setIsConflictInspectorOpen] = useState(false);
	const dispatch = useActions();
	const sessionDispatch = useRootDispatch();
	const scope = useContext(ScopeContext);
	const clipAttrs = useAttrs([
		"name",
		"start",
		"duration",
		"in",
		"opacity",
		"color",
		"$meta$aggregates$crdt$clipTiming$open_conflicts_count",
		"$meta$aggregates$crdt$clipTiming$last_resolution_error",
		"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
		"$meta$rels$crdt$clips$open_conflicts_count",
		"$meta$model$crdt$open_conflicts_count",
		"$meta$model$crdt$last_resolution_error",
	]) as ClipRenderAttrs;
	const effectScopes = useMany("effects");
	const conflictScopes = useMany("crdtConflicts");
	const resourceScope = useOne("resource");
	const resourceAttrs = useScopeAttrs(resourceScope, ["duration"]) as ResourceRenderAttrs;
	const clipId = typeof scope?._nodeId === "string" ? scope._nodeId : null;

	// Skeleton guard: start/duration arrive slightly after the clip node appears
	// in the track's clips relation (worker streams structure before attrs).
	// Render nothing until both critical positioning attrs are present.
	if (clipAttrs.start == null || clipAttrs.duration == null) {
		return null;
	}

	const selected = clipId !== null && selectedEntityId === clipId;
	const name = String(clipAttrs.name);
	const start = Number(clipAttrs.start);
	const duration = Number(clipAttrs.duration);
	const inPoint = Number(clipAttrs.in);
	const sourceDuration =
		typeof resourceAttrs?.duration === "number" &&
		Number.isFinite(resourceAttrs.duration)
			? resourceAttrs.duration
			: null;
	const opacity = Number(clipAttrs.opacity?.value ?? 1);
	const color = String(clipAttrs.color ?? "#2563eb");
	const clipConflictState = clipAttrs as unknown as Record<string, unknown>;
	const [conflictItemsById, setConflictItemsById] = useState<
		Record<string, ClipConflictItem>
	>({});
	const conflictItems: ClipConflictItem[] =
		conflictScopes.length > 0
			? conflictScopes.map(
					(conflictScope) =>
						conflictItemsById[conflictScope._nodeId] ?? {
							id: conflictScope._nodeId,
							scope: "clipTiming",
						},
				)
			: [];
	const width = Math.max(36, duration * timelineZoom);
	const left = Math.max(0, start * timelineZoom + dragPreviewDeltaPx);
	const selectClip = (): void => {
		if (clipId) {
			sessionDispatch("selectEntity", clipId);
		}
	};
	const splitAtPointer = (clientX: number, element: HTMLElement): void => {
		const rect = element.getBoundingClientRect();
		const localTime = Math.max(0, (clientX - rect.left) / timelineZoom);
		dispatch("splitSelfAt", { time: start + localTime });
	};
	const getResizeDeltaSeconds = (
		edge: "start" | "end",
		deltaSeconds: number,
		base: ClipTimelineAttrs = timelineAttrsPayload(),
	): number => {
		return getClipResizeDeltaSecondsForUi(
			edge,
			deltaSeconds,
			base,
			sourceDuration,
		);
	};
	const makeTimingIntentMeta = (batchId: string) => ({
		intent: { batch_id: batchId },
	});
	const timelineAttrsPayload = (): ClipTimelineAttrs => ({
		start,
		in: Number.isFinite(inPoint) ? inPoint : 0,
		duration,
		fadeIn: 0,
		fadeOut: 0,
	});
	const commitTimelineGesture = (
		batchId: string,
		original: ClipTimelineAttrs,
		finalAttrs: ClipTimelineAttrs,
	): void => {
		const meta = makeTimingIntentMeta(batchId);
		dispatch("cleanupTimelineGesture", original, meta);
		dispatch("commitTimelineAttrs", finalAttrs, meta);
	};
	const applyMoveDelta = (
		state: Extract<ClipPointerDragState, { kind: "move" }>,
		clientX: number,
	): ClipTimelineAttrs | null => {
		const deltaSeconds =
			Math.round(((clientX - state.lastClientX) / timelineZoom) * 100) / 100;
		if (deltaSeconds === 0) {
			return null;
		}

		selectClip();
		dispatch(
			"previewMoveBy",
			{ delta: deltaSeconds },
			makeTimingIntentMeta(state.batchId),
		);
		dragState.current = {
			...state,
			lastClientX: state.lastClientX + deltaSeconds * timelineZoom,
			current: {
				...state.current,
				start: Math.max(
					0,
					Math.round((state.current.start + deltaSeconds) * 10) / 10,
				),
			},
		};
		return dragState.current.current;
	};
	const applyResizeDelta = (
		state: Extract<
			ClipPointerDragState,
			{ kind: "resize-start" | "resize-end" }
		>,
		clientX: number,
	): ClipTimelineAttrs | null => {
		const edge = state.kind === "resize-start" ? "start" : "end";
		const requestedDeltaSeconds =
			Math.round(((clientX - state.lastClientX) / timelineZoom) * 100) / 100;
		const deltaSeconds = getResizeDeltaSeconds(
			edge,
			requestedDeltaSeconds,
			state.current,
		);
		if (deltaSeconds === 0) {
			return null;
		}

		selectClip();
		dispatch(
			"previewResize",
			{ edge, delta: deltaSeconds },
			makeTimingIntentMeta(state.batchId),
		);
		const nextCurrent =
			edge === "end"
				? {
						...state.current,
						duration:
							Math.round((state.current.duration + deltaSeconds) * 10) / 10,
					}
				: {
						...state.current,
						start: Math.round((state.current.start + deltaSeconds) * 10) / 10,
						in: Math.round((state.current.in + deltaSeconds) * 10) / 10,
						duration:
							Math.round((state.current.duration - deltaSeconds) * 10) / 10,
					};
		dragState.current = {
			...state,
			lastClientX: state.lastClientX + deltaSeconds * timelineZoom,
			current: nextCurrent,
		};
		return nextCurrent;
	};
	const finishPointerDrag = (clientX: number): void => {
		const state = dragState.current;
		dragState.current = null;
		setDragPreviewDeltaPx(0);
		if (!state) {
			return;
		}

		if (state.kind === "resize-start" || state.kind === "resize-end") {
			const finalAttrs =
				applyResizeDelta(state, clientX) ?? state.current;
			commitTimelineGesture(state.batchId, state.original, finalAttrs);
			return;
		}

		if (state.kind === "move" && activeTool === "select") {
			const finalAttrs = applyMoveDelta(state, clientX) ?? timelineAttrsPayload();
			commitTimelineGesture(state.batchId, state.original, finalAttrs);
			return;
		}
		if (state.kind === "move") {
			return;
		}
	};

	return (
		<div
			role="button"
			tabIndex={0}
			aria-pressed={selected}
			className={`ve-clip${selected ? " is-selected" : ""}`}
			data-tool={activeTool}
			style={{
				left: `${left}px`,
				width: `${width}px`,
				borderLeft: `4px solid ${color}`,
			}}
			onClick={(event) => {
				if (activeTool === "split") {
					splitAtPointer(event.clientX, event.currentTarget);
					return;
				}

				if (activeTool !== "hand") {
					selectClip();
				}
			}}
			onKeyDown={(event) => {
				if (event.key !== "Enter" && event.key !== " ") {
					return;
				}

				event.preventDefault();
				if (activeTool === "split") {
					splitAtPointer(
						event.currentTarget.getBoundingClientRect().left +
							event.currentTarget.getBoundingClientRect().width / 2,
						event.currentTarget,
					);
					return;
				}

				if (activeTool !== "hand") {
					selectClip();
				}
			}}
			onPointerDown={(event) => {
				if (
					(event.target as HTMLElement | null)?.closest(
						".ve-clip__resize-handle",
					)
				) {
					return;
				}
				if (activeTool !== "select") {
					return;
				}

				event.currentTarget.setPointerCapture?.(event.pointerId);
				const original = timelineAttrsPayload();
				dragState.current = {
					kind: "move",
					startX: event.clientX,
					lastClientX: event.clientX,
					batchId: createClipTimingBatchId(clipId),
					original,
					current: original,
				};
			}}
			onPointerMove={(event) => {
				const state = dragState.current;
				if (!state || (event.buttons & 1) === 0) {
					return;
				}

				if (state.kind === "resize-start" || state.kind === "resize-end") {
					applyResizeDelta(state, event.clientX);
					return;
				}
				if (activeTool !== "select") {
					return;
				}

				if (state.kind === "move") {
					applyMoveDelta(state, event.clientX);
				}
			}}
			onPointerUp={(event) => {
				finishPointerDrag(event.clientX);
			}}
			onPointerCancel={() => {
				const state = dragState.current;
				if (state) {
					dispatch(
						"cleanupTimelineGesture",
						state.original,
						makeTimingIntentMeta(state.batchId),
					);
				}
				dragState.current = null;
				setDragPreviewDeltaPx(0);
			}}
		>
			<span
				className="ve-clip__resize-handle ve-clip__resize-handle--start"
				aria-label="Resize clip start"
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation();
					event.currentTarget.setPointerCapture?.(event.pointerId);
					selectClip();
					const original = timelineAttrsPayload();
					dragState.current = {
						kind: "resize-start",
						startX: event.clientX,
						lastClientX: event.clientX,
						batchId: createClipTimingBatchId(clipId),
						original,
						current: original,
					};
				}}
				onPointerUp={(event) => {
					event.stopPropagation();
					finishPointerDrag(event.clientX);
				}}
			/>
			<div className="ve-clip__title">
				<span>{name}</span>
				{effectScopes.map((effectScope) => (
					<ScopeContext.Provider key={effectScope._nodeId} value={effectScope}>
						<ClipGradeBadge />
					</ScopeContext.Provider>
				))}
				<ClipConflictBadge
					model={{ states: clipConflictState, dispatch }}
					scope="all"
					onOpen={() => setIsConflictInspectorOpen(true)}
				/>
			</div>
			<small>
				{name} | {formatSeconds(start)} / {formatSeconds(duration)} | opacity{" "}
				{formatPercent(opacity)}
			</small>
			<span
				className="ve-clip__resize-handle ve-clip__resize-handle--end"
				aria-label="Resize clip end"
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation();
					event.currentTarget.setPointerCapture?.(event.pointerId);
					selectClip();
					const original = timelineAttrsPayload();
					dragState.current = {
						kind: "resize-end",
						startX: event.clientX,
						lastClientX: event.clientX,
						batchId: createClipTimingBatchId(clipId),
						original,
						current: original,
					};
				}}
				onPointerUp={(event) => {
					event.stopPropagation();
					finishPointerDrag(event.clientX);
				}}
			/>
			{isConflictInspectorOpen ? (
				<div
					className="ve-clip-conflict-popover"
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => event.stopPropagation()}
					onPointerDown={(event) => event.stopPropagation()}
				>
					{conflictScopes.map((conflictScope) => (
						<ScopeContext.Provider
							key={conflictScope._nodeId}
							value={conflictScope}
						>
							<ClipConflictProjectionItem
								scope={conflictScope}
								onRead={(item) =>
									setConflictItemsById((current) =>
										sameConflictItem(current[conflictScope._nodeId], item)
											? current
											: { ...current, [conflictScope._nodeId]: item },
									)
								}
							/>
						</ScopeContext.Provider>
					))}
					<ConflictInspectorPanel
						model={{ states: clipConflictState, dispatch }}
						conflicts={conflictItems}
						onClose={() => setIsConflictInspectorOpen(false)}
					/>
				</div>
			) : null}
		</div>
	);
};
