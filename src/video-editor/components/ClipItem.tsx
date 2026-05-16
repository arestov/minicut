import { useContext, useEffect, useRef, useState } from "react";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import { useActions } from "../../dkt-react-sync/hooks/useActions";
import { useAttrs } from "../../dkt-react-sync/hooks/useAttrs";
import { useMany } from "../../dkt-react-sync/hooks/useMany";
import { useRootDispatch } from "../../dkt-react-sync/hooks/useRootDispatch";
import type { AnimatedScalar } from "../render/registryTypes";
import { ClipConflictBadge } from "./ClipConflictBadge";
import {
	ConflictInspectorPanel,
	type ClipConflictItem,
} from "./ConflictInspectorPanel";
import { formatPercent, formatSeconds } from "./format";

const MIN_CLIP_DURATION = 0.5;

const clamp = (value: number, min: number, max: number): number => {
	const safeMax = Math.max(min, max);
	return Math.min(safeMax, Math.max(min, value));
};

type ClipPointerDragState =
	| { kind: "move"; startX: number }
	| {
			kind: "resize-start" | "resize-end";
			startX: number;
			lastClientX: number;
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
	"$meta$model$crdt$open_conflicts_count"?: unknown;
	"$meta$model$crdt$last_resolution_error"?: unknown;
}

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
		"$meta$model$crdt$open_conflicts_count",
		"$meta$model$crdt$last_resolution_error",
	]) as ClipRenderAttrs;
	const effectScopes = useMany("effects");
	const conflictScopes = useMany("crdtConflicts");
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
	const getMovePreviewDeltaPx = (deltaPx: number): number => {
		const requestedStart = start + deltaPx / timelineZoom;
		const clampedStart = clamp(requestedStart, 0, Number.POSITIVE_INFINITY);

		return (clampedStart - start) * timelineZoom;
	};
	const getResizeDeltaSeconds = (
		edge: "start" | "end",
		deltaSeconds: number,
	): number => {
		const clipEnd = start + duration;

		if (edge === "end") {
			const nextEnd = clamp(
				clipEnd + deltaSeconds,
				start + MIN_CLIP_DURATION,
				Number.POSITIVE_INFINITY,
			);
			return nextEnd - clipEnd;
		}

		const minStart = Math.max(0, start - inPoint);
		const nextStart = clamp(
			start + deltaSeconds,
			minStart,
			clipEnd - MIN_CLIP_DURATION,
		);
		return nextStart - start;
	};
	const applyResizeDelta = (
		state: Extract<
			ClipPointerDragState,
			{ kind: "resize-start" | "resize-end" }
		>,
		clientX: number,
	): void => {
		const edge = state.kind === "resize-start" ? "start" : "end";
		const requestedDeltaSeconds =
			Math.round(((clientX - state.lastClientX) / timelineZoom) * 100) / 100;
		const deltaSeconds = getResizeDeltaSeconds(edge, requestedDeltaSeconds);
		if (deltaSeconds === 0) {
			return;
		}

		selectClip();
		dispatch("resize", { edge, delta: deltaSeconds });
		dragState.current = {
			...state,
			lastClientX: state.lastClientX + deltaSeconds * timelineZoom,
		};
	};
	const finishPointerDrag = (clientX: number): void => {
		const state = dragState.current;
		dragState.current = null;
		setDragPreviewDeltaPx(0);
		if (!state) {
			return;
		}

		if (state.kind === "resize-start" || state.kind === "resize-end") {
			applyResizeDelta(state, clientX);
			return;
		}

		const deltaSeconds =
			Math.round(((clientX - state.startX) / timelineZoom) * 100) / 100;
		if (deltaSeconds === 0) {
			return;
		}

		selectClip();
		if (state.kind === "move" && activeTool === "select") {
			dispatch("moveBy", { delta: deltaSeconds });
			return;
		}
		if (state.kind === "move") {
			return;
		}

		dispatch("resize", {
			edge: state.kind === "resize-start" ? "start" : "end",
			delta: deltaSeconds,
		});
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
				dragState.current = { kind: "move", startX: event.clientX };
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

				setDragPreviewDeltaPx(
					getMovePreviewDeltaPx(event.clientX - state.startX),
				);
			}}
			onPointerUp={(event) => {
				finishPointerDrag(event.clientX);
			}}
			onPointerCancel={() => {
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
					dragState.current = {
						kind: "resize-start",
						startX: event.clientX,
						lastClientX: event.clientX,
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
					timing={true}
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
					dragState.current = {
						kind: "resize-end",
						startX: event.clientX,
						lastClientX: event.clientX,
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
