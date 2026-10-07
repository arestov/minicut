import path from "node:path";

/**
 * PROVISIONAL on-disk layout of a Node/Electron/GPUIX profile directory.
 * Not decided yet (stage 1 stop point); every path and schema constant lives
 * here so the decision touches one file.
 *
 *   <profileDir>/minicut-profile.json            profile + default workspace metadata
 *   <profileDir>/workspaces/<roomId>/leveldb/    LevelDB of that workspace
 *   <profileDir>/cache/preview-proxies/          scrub proxy cache (regenerable)
 *   <profileDir>/cache/audio-mix/                rendered timeline audio (per run, wiped on start)
 *   <profileDir>/workspaces/<roomId>/assets.json host asset registry (asset id -> local path)
 */
export const NODE_PROFILE_METADATA_FILE_NAME = "minicut-profile.json";
export const NODE_PROFILE_WORKSPACES_DIR_NAME = "workspaces";
export const NODE_WORKSPACE_LEVELDB_DIR_NAME = "leveldb";
export const NODE_PROFILE_CACHE_DIR_NAME = "cache";
export const NODE_PREVIEW_PROXIES_DIR_NAME = "preview-proxies";
export const NODE_AUDIO_MIX_DIR_NAME = "audio-mix";

export const NODE_PROFILE_METADATA_KIND = "minicut-profile";
/** Highest profile metadata schema this build can read and write. */
export const NODE_PROFILE_METADATA_VERSION = 1;

/** Default directory of the scrub proxy cache; safe to delete at any time. */
export const resolveNodePreviewProxyDir = (profileDir: string): string =>
	path.join(
		profileDir,
		NODE_PROFILE_CACHE_DIR_NAME,
		NODE_PREVIEW_PROXIES_DIR_NAME,
	);
/** Directory of the rendered timeline audio cache; owned by one running host, wiped on start. */
export const resolveNodeAudioMixCacheDir = (profileDir: string): string =>
	path.join(profileDir, NODE_PROFILE_CACHE_DIR_NAME, NODE_AUDIO_MIX_DIR_NAME);
export const NODE_WORKSPACE_ASSET_REGISTRY_FILE_NAME = "assets.json";
