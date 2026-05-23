import type { MiniCutActivitySummary } from "../../dkt/review/types";

type ActivitySummaryPanelProps = {
	summaries: MiniCutActivitySummary[];
};

export const ActivitySummaryPanel = ({ summaries }: ActivitySummaryPanelProps) => (
	<section className="ve-review-activity" aria-label="Sync activity">
		<header>
			<h3>Activity</h3>
		</header>
		{summaries.length === 0 ? (
			<p>No sync activity</p>
		) : (
			<ul>
				{summaries.map((summary) => (
					<li key={summary.id}>
						<strong>{summary.title}</strong>
						<span>
							{summary.created.length} created · {summary.updated.length} updated ·{" "}
							{summary.deleted.length} deleted
						</span>
					</li>
				))}
			</ul>
		)}
	</section>
);
