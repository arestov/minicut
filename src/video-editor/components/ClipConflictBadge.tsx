import { AlertTriangle } from "lucide-react";
import type { MouseEvent, PointerEvent } from "react";

type ClipConflictBadgeProps = {
	/** Open review items about the clip (Clip.openReviewItemCount). */
	count: number;
	onOpen?: () => void;
};

export const ClipConflictBadge = ({ count, onOpen }: ClipConflictBadgeProps) => {
	if (!(count > 0)) {
		return null;
	}

	const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
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
