/**
 * PROVISIONAL on-disk layout of a Node/Electron/GPUIX profile directory.
 * Not decided yet (stage 1 stop point); every path and schema constant lives
 * here so the decision touches one file.
 *
 *   <profileDir>/minicut-profile.json            profile + default workspace metadata
 *   <profileDir>/workspaces/<roomId>/leveldb/    LevelDB of that workspace
 */
export const NODE_PROFILE_METADATA_FILE_NAME = "minicut-profile.json";
export const NODE_PROFILE_WORKSPACES_DIR_NAME = "workspaces";
export const NODE_WORKSPACE_LEVELDB_DIR_NAME = "leveldb";

export const NODE_PROFILE_METADATA_KIND = "minicut-profile";
/** Highest profile metadata schema this build can read and write. */
export const NODE_PROFILE_METADATA_VERSION = 1;
