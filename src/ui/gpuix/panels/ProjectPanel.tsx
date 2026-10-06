import {
	Many,
	One,
	useAttrs,
	useRootDispatch,
	useScope,
} from "../../../dkt-solid-sync";
import { Panel } from "../controls/Panel";
import { useRootAttrs } from "../hooks/useRootAttrs";
import { colors, metrics } from "../theme";

const ProjectRow = () => {
	const scope = useScope();
	const attrs = useAttrs(["title"]);
	const root = useRootAttrs(["activeProjectId"]);
	const dispatch = useRootDispatch();
	const nodeId = () => scope()?._nodeId ?? null;
	const selected = () => nodeId() !== null && root.activeProjectId() === nodeId();

	return (
		<div
			role="button"
			tabIndex={0}
			testId="project-row"
			aria-selected={selected()}
			onClick={() => {
				const id = nodeId();
				if (id) dispatch("setActiveProject", id);
			}}
			style={{
				display: "flex",
				alignItems: "center",
				height: 30,
				flexShrink: 0,
				paddingLeft: 10,
				paddingRight: 10,
				borderRadius: metrics.radius,
				backgroundColor: selected() ? colors.accent : "transparent",
				color: colors.text,
				cursor: "pointer",
				userSelect: "none",
				hover: { backgroundColor: selected() ? colors.accent : colors.controlHover },
			}}
		>
			<text>{String(attrs.title())}</text>
		</div>
	);
};

/** All projects of the workspace; clicking a row makes it the active project. */
export const ProjectPanel = () => (
	<Panel title="Projects" testId="project-panel" height={150}>
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 2,
				padding: 6,
				overflowY: "scroll",
			}}
		>
			<One rel="pioneer">
				<Many
					rel="project"
					item={ProjectRow}
					readyAttr="title"
					empty={<text style={{ color: colors.textMuted, fontSize: 12 }}>No projects</text>}
				/>
			</One>
		</div>
	</Panel>
);
