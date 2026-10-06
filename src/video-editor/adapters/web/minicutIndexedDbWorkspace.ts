import {
	createMiniCutHarnessWorkspaceId,
	encodeWorkspacePart,
} from "../../dkt/storage/minicutWorkspaceManifest";

export const MINICUT_INDEXEDDB_SCHEMA_VERSION = 2;

const DB_NAME_PREFIX = "minicut-crdt-workspace-";

export const createMiniCutWorkspaceDbName = (workspaceId: string): string =>
	`${DB_NAME_PREFIX}${encodeWorkspacePart(workspaceId)}`;

export const createMiniCutHarnessDbName = (
	roomId: string | null | undefined,
): string =>
	createMiniCutWorkspaceDbName(createMiniCutHarnessWorkspaceId(roomId));
