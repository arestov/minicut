import { Show } from "solid-js";
import { One, useAttrs } from "../../../dkt-solid-sync";
import {
	clampProgressPercent,
	formatExportProgress,
	type ExportProgressState,
} from "../../../video-editor/app/exportProgressState";
import { useHostServices } from "../host/hostServices";
import { colors } from "../theme";

const ProgressBar = (props: {
	testId: string;
	percent: number;
	failed?: boolean;
}) => (
	<div
		testId={props.testId}
		role="progressbar"
		aria-valuetext={`${props.percent}%`}
		style={{
			width: 96,
			height: 6,
			flexShrink: 0,
			borderRadius: 3,
			backgroundColor: colors.control,
			overflow: "hidden",
		}}
	>
		<div
			testId={`${props.testId}-fill`}
			style={{
				width: `${props.percent}%`,
				height: 6,
				backgroundColor: props.failed ? colors.danger : colors.accent,
			}}
		/>
	</div>
);

const isExportProgress = (value: unknown): value is ExportProgressState =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { stage?: unknown }).stage === "string";

/** Export progress: the session `exportProgress` attr, shown as it is. */
export const ExportProgress = () => {
	const session = useAttrs(["exportProgress"]);
	const host = useHostServices();
	const state = () => {
		const value = session.exportProgress();
		return isExportProgress(value) ? value : null;
	};

	return (
		<Show when={state()}>
			{(current) => (
				<div
					testId="export-progress"
					style={{ display: "flex", alignItems: "center", gap: 8 }}
				>
					<text testId="export-progress-label">{`Export ${formatExportProgress(current())}`}</text>
					<Show when={host && current().stage === "done" && current().fileName}>
						<text testId="export-progress-file" style={{ color: colors.textMuted }}>
							{`${host?.exportDirectory ?? ""} | ${current().fileName ?? ""}`}
						</text>
					</Show>
					<ProgressBar
						testId="export-progress-bar"
						percent={clampProgressPercent(current().progress)}
						failed={current().stage === "error"}
					/>
				</div>
			)}
		</Show>
	);
};

type ImportProgressValue = {
	stage?: unknown;
	processed?: unknown;
	total?: unknown;
	error?: unknown;
};

const ImportProgressBody = () => {
	const project = useAttrs(["importProgress"]);
	const state = () => {
		const value = project.importProgress();
		return typeof value === "object" && value !== null
			? (value as ImportProgressValue)
			: null;
	};
	const processed = () => Number(state()?.processed ?? 0);
	const total = () => Number(state()?.total ?? 0);
	const percent = () => (total() > 0 ? clampProgressPercent((processed() / total()) * 100) : 0);
	const label = () => {
		const current = state();
		if (!current) return "";
		if (current.stage === "error") {
			return typeof current.error === "string" && current.error
				? `Import failed: ${current.error}`
				: "Import failed";
		}
		return `Import ${String(current.stage)} ${processed()}/${total()}`;
	};

	return (
		<Show when={state()}>
			<div
				testId="import-progress"
				style={{ display: "flex", alignItems: "center", gap: 8 }}
			>
				<text testId="import-progress-label">{label()}</text>
				<ProgressBar
					testId="import-progress-bar"
					percent={percent()}
					failed={state()?.stage === "error"}
				/>
			</div>
		</Show>
	);
};

/** Import progress of the active project: its `importProgress` attr. */
export const ImportProgress = () => (
	<One rel="activeProject">
		<ImportProgressBody />
	</One>
);

const RecoveryPhaseBody = () => {
	const task = useAttrs(["phase", "reasonCode", "errorMessage"]);
	return (
		<text
			testId="recovery-phase"
			style={{
				color: task.phase() === "failed" || task.phase() === "rejected" ? colors.danger : "#f59e0b",
				fontSize: 11,
			}}
		>
			{`Recovery: ${String(task.phase()).replaceAll("-", " ")}`}
		</text>
	);
};

/**
 * Phase of the resource's active media recovery task. Rendered inside a
 * resource scope; shows nothing while the resource has no active task.
 */
export const RecoveryPhase = () => (
	<One rel="activeMediaRecoveryTask" readyAttr="phase">
		<RecoveryPhaseBody />
	</One>
);
