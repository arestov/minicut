import { Toolbar } from './Toolbar'
import { ProjectSidebar } from './ProjectSidebar'
import { MediaBin } from './MediaBin'
import { TimelineView } from './TimelineView'
import { Inspector } from './Inspector'
import { PreviewPanel } from './PreviewPanel'

export const VideoEditorApp = () => (
	<div className="ve-shell">
		<Toolbar />
		<div className="ve-layout">
			<ProjectSidebar />
			<main className="ve-main">
				<div className="ve-main__top">
					<MediaBin />
					<PreviewPanel />
					<Inspector />
				</div>
				<TimelineView />
			</main>
		</div>
	</div>
)
