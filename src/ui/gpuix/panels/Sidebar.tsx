import { ProjectPanel } from "./ProjectPanel";
import { ResourcePanel } from "./ResourcePanel";

/** Sidebar content: project list above the active project's resources. */
export const Sidebar = () => (
	<>
		<ProjectPanel />
		<ResourcePanel />
	</>
);
