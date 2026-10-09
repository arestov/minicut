import { Show, createEffect, on } from "solid-js";
import { One, useAttrs, useMany } from "../../../dkt-solid-sync";
import { Button } from "../controls/Button";
import { useReviewMode } from "./reviewModeState";

const Trigger = () => {
	const mode = useReviewMode();
	const counts = useAttrs(["reviewOpenItemCount"]);
	const items = useMany("reviewItems");
	const sessions = useMany("reviewSessions");
	const summaries = useMany("activitySummaries");
	const openCount = () => {
		const value = counts.reviewOpenItemCount();
		return typeof value === "number" && Number.isFinite(value) ? value : 0;
	};

	// New open conflicts bring review mode up, as in Web.
	createEffect(
		on(
			openCount,
			(count, previous) => {
				if (count > 0 && count > (previous ?? 0)) mode.open();
			},
			{ defer: false },
		),
	);

	return (
		<Show when={items().length > 0 || sessions().length > 0 || summaries().length > 0}>
			<Button
				testId="review-trigger"
				aria-label={openCount() > 0 ? `Review ${openCount()}` : "Review"}
				active={mode.isOpen()}
				onClick={() => (mode.isOpen() ? mode.close() : mode.open())}
			>
				<text>{openCount() > 0 ? `Review ${openCount()}` : "Review"}</text>
			</Button>
		</Show>
	);
};

/**
 * Toolbar entry to review mode. It exists only while the active project has
 * review items or sessions and carries the model's open item count.
 */
export const ReviewTrigger = () => (
	<One rel="activeProject">
		<Trigger />
	</One>
);
