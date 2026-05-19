import { AlertTriangle } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";

type ConflictBadgeModel = {
	states?: Record<string, unknown>;
	dispatch?: (actionName: string, payload?: unknown) => void | Promise<void>;
};

type ClipConflictBadgeProps = {
	model: ConflictBadgeModel;
	scope?: "all" | "model" | "timing";
	timing?: boolean;
	onOpen?: () => void;
};

const COUNT_ATTRS = {
	model: ["$meta$model$crdt$open_conflicts_count"],
	timing: ["$meta$aggregates$crdt$clipTiming$open_conflicts_count"],
	structural: [
		"$meta$aggregates$crdt$timelineMembership$open_conflicts_count",
		"$meta$rels$crdt$clips$open_conflicts_count",
	],
} as const;

const readNumber = (model: ConflictBadgeModel, attrName: string): number => {
	const value = model.states?.[attrName];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const readCount = (
	model: ConflictBadgeModel,
	scope: NonNullable<ClipConflictBadgeProps["scope"]>,
): number => {
	const attrs =
		scope === "timing"
			? COUNT_ATTRS.timing
			: scope === "model"
				? COUNT_ATTRS.model
				: [
						...COUNT_ATTRS.timing,
						...COUNT_ATTRS.structural,
						...COUNT_ATTRS.model,
					];
	return Math.max(0, ...attrs.map((attrName) => readNumber(model, attrName)));
};

const buildLoadScope = (
	scope: NonNullable<ClipConflictBadgeProps["scope"]>,
) => {
	if (scope === "timing") {
		return { aggregate: "clipTiming" };
	}
	if (scope === "model") {
		return { model: "clip" };
	}
	return { model: "clip", include_structural: true };
};

export const ClipConflictBadge = ({
	model,
	scope,
	timing = false,
	onOpen,
}: ClipConflictBadgeProps) => {
	const resolvedScope = scope ?? (timing ? "timing" : "all");
	const count = readCount(model, resolvedScope);
	if (count <= 0) {
		return null;
	}

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		void model.dispatch?.("loadConflicts", {
			scope: buildLoadScope(resolvedScope),
		});
		onOpen?.();
	};
	const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
		event.stopPropagation();
	};

	return (
		<button
			type="button"
			className="clip-conflict-badge"
			title="Open conflicts"
			onPointerDown={handlePointerDown}
			onClick={handleClick}
			aria-label={`${count} open conflict${count === 1 ? "" : "s"}`}
		>
			<AlertTriangle aria-hidden="true" size={14} />
			<span>{count}</span>
		</button>
	);
};
