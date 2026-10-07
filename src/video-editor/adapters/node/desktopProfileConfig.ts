import os from "node:os";
import path from "node:path";

/**
 * Where the desktop app keeps its profile (identity, workspace LevelDB, asset
 * registry). `MINICUT_PROFILE_DIR` wins; otherwise a per-user app-data folder.
 */
export const resolveProfileDir = (
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	home: string = os.homedir(),
): string => {
	if (env.MINICUT_PROFILE_DIR) return path.resolve(env.MINICUT_PROFILE_DIR);
	if (platform === "win32") {
		return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "MiniCut", "gpuix-profile");
	}
	if (platform === "darwin") {
		return path.join(home, "Library", "Application Support", "MiniCut", "gpuix-profile");
	}
	return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "minicut", "gpuix-profile");
};

/** Exports go to `MINICUT_EXPORT_DIR`, else next to the profile. */
export const resolveExportDir = (
	profileDir: string,
	env: NodeJS.ProcessEnv = process.env,
): string =>
	env.MINICUT_EXPORT_DIR ? path.resolve(env.MINICUT_EXPORT_DIR) : path.join(profileDir, "exports");
