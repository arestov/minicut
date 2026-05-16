import { Check, Eye, GitMerge, X } from "lucide-react";

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
	dispatch?: (actionName: string, payload?: unknown) => void | Promise<void>;
};

type ConflictInspectorPanelProps = {
	model: ConflictInspectorModel;
	conflicts: ClipConflictItem[];
	onClose?: () => void;
};

export const ConflictInspectorPanel = ({
	model,
	conflicts,
	onClose,
}: ConflictInspectorPanelProps) => {
	const dispatch = (actionName: string, payload?: unknown) => {
		void model.dispatch?.(actionName, payload);
	};
	const resolvable = conflicts.filter((conflict) => conflict.decision);

	return (
		<section className="conflict-inspector-panel" aria-label="Conflict inspector">
			<header>
				<h2>Conflicts</h2>
				<button type="button" title="Close" aria-label="Close" onClick={onClose}>
					<X aria-hidden="true" size={16} />
				</button>
			</header>
			{conflicts.length === 0 ? (
				<p>No open conflicts</p>
			) : (
				<ul>
					{conflicts.map((conflict) => (
						<li key={conflict.id}>
							<div>
								<strong>{conflict.summary ?? conflict.kind ?? conflict.id}</strong>
								{conflict.scope ? <span>{conflict.scope}</span> : null}
							</div>
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
										type="button"
										title="Resolve timing"
										aria-label="Resolve timing"
										onClick={() =>
											dispatch("resolveClipTimingConflict", {
												conflict_id: conflict.id,
												...conflict.decision,
											})
										}
									>
										<GitMerge aria-hidden="true" size={16} />
									</button>
								) : null}
							</div>
						</li>
					))}
				</ul>
			)}
			<button
				type="button"
				disabled={resolvable.length === 0}
				onClick={() =>
					dispatch("resolveClipTimingConflictsBatch", {
						decisions: resolvable.map((conflict) => ({
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
