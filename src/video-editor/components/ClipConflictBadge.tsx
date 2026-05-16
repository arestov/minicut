import { AlertTriangle } from "lucide-react";
import type { MouseEvent } from "react";

type ConflictBadgeModel = {
	states?: Record<string, unknown>;
	dispatch?: (actionName: string, payload?: unknown) => void | Promise<void>;
};

type ClipConflictBadgeProps = {
	model: ConflictBadgeModel;
	timing?: boolean;
	onOpen?: () => void;
};

const readCount = (model: ConflictBadgeModel, timing: boolean): number => {
	const attrName = timing
		? "$meta$aggregates$crdt$clipTiming$open_conflicts_count"
		: "$meta$model$crdt$open_conflicts_count";
	const value = model.states?.[attrName];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

export const ClipConflictBadge = ({
	model,
	timing = false,
	onOpen,
}: ClipConflictBadgeProps) => {
	const count = readCount(model, timing);
	if (count <= 0) {
		return null;
	}

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		void model.dispatch?.("loadConflicts", {
			scope: timing ? { aggregate: "clipTiming" } : { model: "clip" },
		});
		onOpen?.();
	};

	return (
		<button
			type="button"
			className="clip-conflict-badge"
			title="Open conflicts"
			onClick={handleClick}
			aria-label={`${count} open conflict${count === 1 ? "" : "s"}`}
		>
			<AlertTriangle aria-hidden="true" size={14} />
			<span>{count}</span>
		</button>
	);
};
