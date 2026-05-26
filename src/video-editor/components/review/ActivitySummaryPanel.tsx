import type { MiniCutActivitySummary } from "../../dkt/review/types";

type ActivitySummaryPanelProps = {
	summaries: MiniCutActivitySummary[];
};

const rejectedCount = (summary: MiniCutActivitySummary): number =>
	summary.updated.filter((item) => item.status === "rejected").length;

const conflictIds = (summary: MiniCutActivitySummary): string[] => [
	...(summary.openedConflictIds ?? []),
	...(summary.updatedConflictIds ?? []),
];

export const ActivitySummaryPanel = ({ summaries }: ActivitySummaryPanelProps) => {
	const byBatch = new Map<string, MiniCutActivitySummary[]>();
	for (const summary of summaries) {
		const current = byBatch.get(summary.batchId) ?? [];
		current.push(summary);
		byBatch.set(summary.batchId, current);
	}

	return (
		<section className="ve-review-activity" aria-label="Sync activity">
			<header>
				<h3>Activity</h3>
			</header>
			{summaries.length === 0 ? (
				<p>No sync activity</p>
			) : (
				<ul>
					{[...byBatch.entries()].map(([batchId, batchSummaries]) => (
						<li key={batchId}>
							<span>Batch {batchId}</span>
							<ul>
								{batchSummaries.map((summary) => {
									const rejected = rejectedCount(summary);
									const conflicts = conflictIds(summary);
									return (
										<li key={summary.id}>
											<strong>{summary.title}</strong>
											<span>
												{summary.created.length} created ·{" "}
												{summary.updated.length} updated ·{" "}
												{summary.deleted.length} deleted
												{rejected > 0 ? ` · ${rejected} rejected` : ""}
											</span>
											{conflicts.length > 0 ? (
												<nav aria-label={`Conflicts for ${summary.batchId}`}>
													{conflicts.map((conflictId) => (
														<a key={conflictId} href={`#${conflictId}`}>
															{conflictId}
														</a>
													))}
												</nav>
											) : null}
										</li>
									);
								})}
							</ul>
						</li>
					))}
				</ul>
			)}
		</section>
	);
};
