import { NodeLevelDbStorageOpenError } from "../../../adapters/node/createNodeLevelDbStoragePackage";
import { MediaServiceStartError } from "./mediaServiceProcess";

export type StartupFailure = {
	kind: "profile-locked" | "database-unreadable" | "media-service" | "other";
	title: string;
	detail: string;
};

/**
 * What the user is told when the desktop app cannot open its workspace.
 * The profile is shared with the GPUIX app, which must run in turn, so a
 * held database lock gets its own explanation; nothing here falls back to an
 * empty project.
 */
export const describeStartupFailure = (
	error: unknown,
	profileDir: string,
): StartupFailure => {
	if (error instanceof NodeLevelDbStorageOpenError && error.locked) {
		return {
			kind: "profile-locked",
			title: "MiniCut is already open with this profile",
			detail:
				"The project database is in use by another MiniCut window or app " +
				"(the desktop app and the GPUIX app share one profile and run in turn). " +
				"Close the other one, or set MINICUT_PROFILE_DIR to another folder. " +
				`Profile: ${profileDir}`,
		};
	}
	if (error instanceof NodeLevelDbStorageOpenError) {
		return {
			kind: "database-unreadable",
			title: "The project database could not be opened",
			detail: `${error.message}\nProfile: ${profileDir}`,
		};
	}
	if (error instanceof MediaServiceStartError) {
		return {
			kind: "media-service",
			title: "The media service could not start",
			detail: error.message,
		};
	}
	return {
		kind: "other",
		title: "MiniCut cannot open the workspace",
		detail: error instanceof Error ? error.message : String(error),
	};
};
