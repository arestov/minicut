import { type Accessor, createContext, useContext } from "solid-js";
import type { PlaybackSnapshot } from "../../../video-editor/playback/playbackRuntime";
import type { PreviewFrameSource } from "../preview/frameSource";
import type { PreviewPlanInput } from "../preview/nodePreviewController";

/**
 * Host capabilities the UI can use on top of the model: native dialogs and
 * other host-side services. Fixture hosts provide none, so the controls that
 * need them are not shown. The UI never reads paths or handles; everything
 * the model needs travels through its own actions.
 */
export type PreviewHostService = {
	/** Frame source the presenter shows (Node frame producer). */
	readonly source: PreviewFrameSource;
	/** Plan inputs of the active project (declared model attrs); null when there is none. */
	updatePlan(input: PreviewPlanInput | null): void;
	/** Why the preview cannot show the whole timeline, or null. */
	readonly notice: Accessor<string | null>;
};

export type HostServices = {
	/** Opens the native file dialog and imports the picked files. */
	importFromDialog(): Promise<void>;
	/** Opens the native file dialog to locate or replace the source file of a resource. */
	relinkFromDialog(
		resourceId: string,
		intent: "locate-original" | "replace-source",
	): Promise<void>;
	/** Where playback is (silent run along the model playback run). */
	playback?: Accessor<PlaybackSnapshot>;
	/** Automation only (MINICUT_GPUIX_TEST_HOOKS): controls that stand in for native dialogs and window close. */
	testHooks?: {
		importConfiguredFiles(): void;
		quit(): void;
	};
	/** Directory exports are written to; shown next to a finished export. */
	exportDirectory: string;
	/** Node preview frames; fixture hosts omit it and the synthetic source is used. */
	preview?: PreviewHostService;
};

export const HostServicesContext = createContext<HostServices | undefined>(
	undefined,
);

export const useHostServices = (): HostServices | undefined =>
	useContext(HostServicesContext);

export type HostServicesAccessor = Accessor<HostServices | undefined>;
