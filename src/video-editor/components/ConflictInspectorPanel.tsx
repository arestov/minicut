import { Check, CircleX, Eye, GitBranch, GitMerge, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

type ConflictDecision = {
	start?: number;
	in?: number;
	duration?: number;
};

export type ClipConflictItem = {
	id: string;
	kind?: string;
	scope?: string;
	summary?: string;
	decision?: ConflictDecision;
};

type ConflictInspectorModel = {
	states?: Record<string, unknown>;
	dispatch?: (actionName: string, payload?: unknown) => void | Promise<void>;
};

type ConflictInspectorPanelProps = {
	model: ConflictInspectorModel;
	conflicts: ClipConflictItem[];
	onClose?: () => void;
};

type ResolutionAttemptError = {
	code?: string;
	message?: string | null;
	fields?: Record<string, ResolutionAttemptError>;
};

type TimingDecisionFields = Required<ConflictDecision>;

const readResolutionAttemptError = (
	model: ConflictInspectorModel,
): ResolutionAttemptError | null => {
	const value =
		model.states?.["$meta$aggregates$crdt$clipTiming$last_resolution_error"] ??
		model.states?.["$meta$model$crdt$last_resolution_error"];
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as ResolutionAttemptError;
};

const toFiniteNumber = (value: FormDataEntryValue | null): number | null => {
	if (typeof value !== "string" || value.trim() === "") {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDecision = (
	decision: ConflictDecision | undefined,
): TimingDecisionFields => ({
	start: typeof decision?.start === "number" ? decision.start : 0,
	in: typeof decision?.in === "number" ? decision.in : 0,
	duration: typeof decision?.duration === "number" ? decision.duration : 1,
});

const structuralKindText = (kind: string | undefined): string => {
	if (!kind) return "Structural conflict";
	if (kind.includes("delete")) return "Delete conflict";
	if (kind.includes("owner_slot") || kind.includes("move")) return "Placement conflict";
	if (kind.includes("dangling")) return "Reference conflict";
	return "Structural conflict";
};

const isTimingConflict = (conflict: ClipConflictItem): boolean =>
	Boolean(conflict.decision) || conflict.scope === "clipTiming";

const isStructuralConflict = (conflict: ClipConflictItem): boolean =>
	!isTimingConflict(conflict);

const fieldErrorText = (
	attemptError: ResolutionAttemptError | null,
	fieldName: string,
): string | null => {
	const field = attemptError?.fields?.[fieldName];
	return field?.message || field?.code || null;
};

export const ConflictInspectorPanel = ({
	model,
	conflicts,
	onClose,
}: ConflictInspectorPanelProps) => {
	const initialSelectedIds = useMemo(
		() =>
			new Set(
				conflicts
					.filter((conflict) => conflict.decision)
					.map((conflict) => conflict.id),
			),
		[conflicts],
	);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelectedIds);
	const dispatch = (actionName: string, payload?: unknown) => {
		void model.dispatch?.(actionName, payload);
	};
	const resolvable = conflicts.filter((conflict) => conflict.decision);
	const selectedResolvable = resolvable.filter((conflict) =>
		selectedIds.has(conflict.id),
	);
	const attemptError = readResolutionAttemptError(model);
	const attemptErrorText = attemptError?.message || attemptError?.code || null;
	const isSubmitting =
		model.states?.["$meta$aggregates$crdt$clipTiming$last_resolution_status"] ===
		"submitting";
	const resolveTimingConflict = (
		conflict: ClipConflictItem,
		formData: FormData,
	) => {
		const fallback = normalizeDecision(conflict.decision);
		dispatch("resolveClipTimingConflict", {
			conflict_id: conflict.id,
			start: toFiniteNumber(formData.get("start")) ?? fallback.start,
			in: toFiniteNumber(formData.get("in")) ?? fallback.in,
			duration: toFiniteNumber(formData.get("duration")) ?? fallback.duration,
		});
	};
	const resolveStructuralConflict = (conflict: ClipConflictItem, type: string) => {
		dispatch("resolveStructuralConflict", {
			conflict_id: conflict.id,
			decision: { type },
		});
	};

	return (
		<section className="conflict-inspector-panel" aria-label="Conflict inspector">
			<header>
				<h2>Open conflicts</h2>
				<button type="button" title="Close" aria-label="Close" onClick={onClose}>
					<X aria-hidden="true" size={16} />
				</button>
			</header>
			{attemptErrorText ? (
				<div className="conflict-inspector-panel__attempt-error">
					<span>{attemptErrorText}</span>
					<button
						type="button"
						title="Clear resolution error"
						aria-label="Clear resolution error"
						onClick={() =>
							dispatch("clearResolutionAttempt", {
								aggregate: "clipTiming",
								attrs: ["start", "in", "duration"],
							})
						}
					>
						<CircleX aria-hidden="true" size={16} />
					</button>
				</div>
			) : null}
			{conflicts.length === 0 ? (
				<p>No open conflicts</p>
			) : (
				<ul>
					{conflicts.map((conflict) => {
						const decision = normalizeDecision(conflict.decision);
						const timingConflict = isTimingConflict(conflict);
						const structuralConflict = isStructuralConflict(conflict);
						return (
							<li
								key={conflict.id}
								className={`conflict-inspector-panel__item conflict-inspector-panel__item--${timingConflict ? "timing" : "structural"}`}
							>
								<div className="conflict-inspector-panel__item-header">
									{conflict.decision ? (
										<input
											type="checkbox"
											aria-label={`Select ${conflict.id}`}
											checked={selectedIds.has(conflict.id)}
											onChange={(event) =>
												setSelectedIds((current) => {
													const next = new Set(current);
													if (event.currentTarget.checked) {
														next.add(conflict.id);
													} else {
														next.delete(conflict.id);
													}
													return next;
												})
											}
										/>
									) : null}
									<div>
										<strong>{conflict.summary ?? conflict.kind ?? conflict.id}</strong>
										<span>
											{timingConflict ? "Timing conflict" : structuralKindText(conflict.kind)}
											{conflict.scope ? ` · ${conflict.scope}` : ""}
										</span>
									</div>
								</div>
								<form
									onSubmit={(event) => {
										event.preventDefault();
										if (!timingConflict) return;
										resolveTimingConflict(
											conflict,
											new FormData(event.currentTarget),
										);
									}}
								>
									{conflict.decision ? (
										<div className="conflict-inspector-panel__timing-fields">
											<label>
												Start
												<input
													name="start"
													type="number"
													step="0.1"
													defaultValue={decision.start}
													disabled={isSubmitting}
												/>
												{fieldErrorText(attemptError, "start") ? <small>{fieldErrorText(attemptError, "start")}</small> : null}
											</label>
											<label>
												In
												<input
													name="in"
													type="number"
													step="0.1"
													defaultValue={decision.in}
													disabled={isSubmitting}
												/>
												{fieldErrorText(attemptError, "in") ? <small>{fieldErrorText(attemptError, "in")}</small> : null}
											</label>
											<label>
												Duration
												<input
													name="duration"
													type="number"
													step="0.1"
													defaultValue={decision.duration}
													disabled={isSubmitting}
												/>
												{fieldErrorText(attemptError, "duration") ? <small>{fieldErrorText(attemptError, "duration")}</small> : null}
											</label>
										</div>
									) : null}
									{structuralConflict ? (
										<div className="conflict-inspector-panel__structural-actions" aria-label={`Resolve ${conflict.id}`}>
											<button type="button" onClick={() => resolveStructuralConflict(conflict, "keep_local")}>
												<GitBranch aria-hidden="true" size={16} />
												Keep local
											</button>
											<button type="button" onClick={() => resolveStructuralConflict(conflict, "accept_remote_delete")}>
												<Trash2 aria-hidden="true" size={16} />
												Accept delete
											</button>
											<button type="button" onClick={() => resolveStructuralConflict(conflict, "restore") }>
												<RotateCcw aria-hidden="true" size={16} />
												Restore
											</button>
										</div>
									) : null}
									<div className="conflict-inspector-panel__actions">
										<button
											type="button"
											title="Load details"
											aria-label="Load details"
											onClick={() =>
												dispatch("requireConflictDetails", {
													conflict_id: conflict.id,
												})
											}
										>
											<Eye aria-hidden="true" size={16} />
										</button>
										<button
											type="button"
											title="Acknowledge"
											aria-label="Acknowledge"
											onClick={() =>
												dispatch("acknowledgeConflict", {
													conflict_id: conflict.id,
												})
											}
										>
											<Check aria-hidden="true" size={16} />
										</button>
										{conflict.decision ? (
											<button
												type="submit"
												title={isSubmitting ? "Resolving timing" : "Resolve timing"}
												aria-label={isSubmitting ? "Resolving timing" : "Resolve timing"}
												disabled={isSubmitting}
											>
												<GitMerge aria-hidden="true" size={16} />
											</button>
										) : null}
									</div>
								</form>
							</li>
						);
					})}
				</ul>
			)}
			<button
				type="button"
				disabled={selectedResolvable.length === 0}
				onClick={() =>
					dispatch("resolveClipTimingConflictsBatch", {
						atomic: false,
						decisions: selectedResolvable.map((conflict) => ({
							conflict_id: conflict.id,
							...conflict.decision,
						})),
					})
				}
			>
				Resolve selected
			</button>
		</section>
	);
};
