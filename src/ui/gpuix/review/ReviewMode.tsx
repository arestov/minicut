import { Show, createEffect } from "solid-js";
import {
	Many,
	One,
	ScopeContext,
	useAttrs,
	useMany,
	useScope,
} from "../../../dkt-solid-sync";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import type { MiniCutReviewItem } from "../../../video-editor/dkt/review/types";
import { Button } from "../controls/Button";
import { Panel } from "../controls/Panel";
import { colors, metrics } from "../theme";
import { ActivitySummaryList } from "./ActivitySummaryList";
import { ConflictInspector } from "./ConflictInspector";
import { MutedText } from "./ReviewParts";
import { useReviewMode } from "./reviewModeState";

const LIST_WIDTH = 240;
const ACTIVITY_WIDTH = 240;

const ReviewItemRow = () => {
	const scope = useScope();
	const mode = useReviewMode();
	const attrs = useAttrs(["reviewItemSnapshot"]);
	const item = () => attrs.reviewItemSnapshot() as MiniCutReviewItem | undefined;
	const nodeId = () => scope()?._nodeId ?? null;
	const selected = () => nodeId() !== null && mode.selectedNodeId() === nodeId();

	return (
		<div
			role="button"
			tabIndex={0}
			testId="review-item"
			aria-selected={selected()}
			onClick={() => mode.select(nodeId())}
			onKeyDown={(event) => {
				if (event.key === "enter" || event.key === "space") mode.select(nodeId());
			}}
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 2,
				flexShrink: 0,
				padding: 8,
				borderRadius: metrics.radius,
				backgroundColor: selected() ? colors.accent : colors.control,
				cursor: "pointer",
				userSelect: "none",
				hover: { backgroundColor: selected() ? colors.accent : colors.controlHover },
			}}
		>
			<text style={{ fontSize: 12, fontWeight: 600 }}>{item()?.title ?? ""}</text>
			<text style={{ fontSize: 11, color: selected() ? colors.text : colors.textMuted }}>
				{`${(item()?.kind ?? "").replaceAll("_", " ")} · ${item()?.status ?? ""}`}
			</text>
		</div>
	);
};

const ReviewBody = () => {
	const mode = useReviewMode();
	const counts = useAttrs(["reviewOpenItemCount"]);
	const items = useMany("reviewItems");
	const selectedScope = (): ReactSyncScopeHandle | null =>
		items().find((item) => item._nodeId === mode.selectedNodeId()) ?? null;

	// Selection is a node id; keep it on an existing item (first one by default).
	createEffect(() => {
		const scopes = items();
		if (!scopes.some((item) => item._nodeId === mode.selectedNodeId())) {
			mode.select(scopes[0]?._nodeId ?? null);
		}
	});

	return (
		<div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: metrics.gap,
					height: 36,
					flexShrink: 0,
					paddingLeft: 10,
					paddingRight: 10,
					borderBottomWidth: 1,
					borderColor: colors.border,
				}}
			>
				<text testId="review-count" style={{ fontSize: 12, color: colors.textMuted }}>
					{`${Number(counts.reviewOpenItemCount() ?? 0)} open / ${items().length} total`}
				</text>
				<div style={{ flexGrow: 1 }} />
				<Button testId="review-close" aria-label="Close" onClick={() => mode.close()}>
					<text>Close</text>
				</Button>
			</div>
			<div style={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
				<div
					testId="review-list"
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 4,
						width: LIST_WIDTH,
						flexShrink: 0,
						padding: 8,
						overflowY: "scroll",
						borderRightWidth: 1,
						borderColor: colors.border,
					}}
				>
					<Many
						rel="reviewItems"
						item={ReviewItemRow}
						readyAttr="reviewItemSnapshot"
						empty={<MutedText testId="review-list-empty">No review items</MutedText>}
					/>
				</div>
				<div
					testId="review-inspector"
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
						flexGrow: 1,
						minWidth: 0,
						padding: 8,
						overflowY: "scroll",
					}}
				>
					<Show
						when={selectedScope()}
						fallback={<MutedText testId="review-no-selection">No review item selected</MutedText>}
					>
						{(scope) => (
							<ScopeContext.Provider value={scope}>
								<ConflictInspector />
							</ScopeContext.Provider>
						)}
					</Show>
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						width: ACTIVITY_WIDTH,
						flexShrink: 0,
						borderLeftWidth: 1,
						borderColor: colors.border,
					}}
				>
					<ActivitySummaryList />
				</div>
			</div>
		</div>
	);
};

/**
 * Review mode: replaces the preview and inspector area while open. It lists the
 * active project's review items, inspects the selected one and shows the sync
 * activity; every resolution is a model action (see useReviewActions).
 */
export const ReviewMode = () => (
	<Panel title="Project review" testId="review-mode" grow>
		<One rel="activeProject">
			<ReviewBody />
		</One>
	</Panel>
);
