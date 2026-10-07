import { Show } from "solid-js";
import {
	Many,
	One,
	useAttrs,
	useRootDispatch,
	useScope,
} from "../../../dkt-solid-sync";
import { Button } from "../controls/Button";
import { Panel } from "../controls/Panel";
import { RecoveryPhase } from "../tasks/TaskProgress";
import { useHostServices } from "../host/hostServices";
import { colors, metrics } from "../theme";
import {
	describeResourceNote,
	formatDuration,
	formatSize,
} from "./resourceLabels";

const toneColor = {
	danger: colors.danger,
	warning: "#f59e0b",
	info: colors.textMuted,
} as const;

const ResourceRow = () => {
	const scope = useScope();
	const attrs = useAttrs([
		"name",
		"kind",
		"mime",
		"duration",
		"size",
		"status",
		"localMediaAvailability",
		"originalAccessStatus",
	]);
	const dispatch = useRootDispatch();
	const note = () =>
		describeResourceNote({
			status: attrs.status(),
			localMediaAvailability: attrs.localMediaAvailability(),
			originalAccessStatus: attrs.originalAccessStatus(),
		});
	const size = () => formatSize(attrs.size());
	const host = useHostServices();
	const isMissing = () =>
		attrs.originalAccessStatus() === "missing" || attrs.status() === "missing";

	return (
		<div
			testId="resource-row"
			style={{
				display: "flex",
				alignItems: "center",
				gap: metrics.gap,
				flexShrink: 0,
				padding: 8,
				borderRadius: metrics.radius,
				backgroundColor: colors.control,
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
				<text
					style={{
						color: colors.text,
						fontWeight: 600,
						whiteSpace: "nowrap",
						textOverflow: "ellipsis",
						overflow: "hidden",
					}}
				>
					{String(attrs.name())}
				</text>
				<text style={{ color: colors.textMuted, fontSize: 11 }}>
					{`${String(attrs.kind())} | ${formatDuration(attrs.duration())}${size() ? ` | ${size()}` : ""}`}
				</text>
				<RecoveryPhase />
				<Show when={note()}>
					{(current) => (
						<text
							testId="resource-note"
							style={{ color: toneColor[current().tone], fontSize: 11 }}
						>
							{current().label}
						</text>
					)}
				</Show>
			</div>
			<Show when={host && isMissing()}>
				<Button
					testId="resource-locate"
					aria-label="Locate file"
					onClick={() => {
						const id = scope()?._nodeId;
						if (id) void host?.relinkFromDialog(id, "locate-original");
					}}
				>
					<text>Locate</text>
				</Button>
				<Button
					testId="resource-replace"
					aria-label="Replace source"
					onClick={() => {
						const id = scope()?._nodeId;
						if (id) void host?.relinkFromDialog(id, "replace-source");
					}}
				>
					<text>Replace</text>
				</Button>
			</Show>
			<Button
				testId="resource-add"
				aria-label="Add to timeline"
				onClick={() => {
					const id = scope()?._nodeId;
					if (id) dispatch("addActiveProjectResourceToTimeline", id);
				}}
			>
				<text>Add</text>
			</Button>
		</div>
	);
};

/** Resources of the active project. */
export const ResourcePanel = () => (
	<Panel title="Resources" testId="resource-panel" grow>
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 6,
				padding: 6,
				overflowY: "scroll",
			}}
		>
			<One rel="activeProject">
				<Many
					rel="resources"
					item={ResourceRow}
					readyAttr="name"
					empty={<text style={{ color: colors.textMuted, fontSize: 12 }}>No resources</text>}
				/>
			</One>
		</div>
	</Panel>
);
