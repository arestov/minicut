import type { IpcMainEvent } from "electron";
import path from "node:path";
import { ELECTRON_IPC, type DesktopImportStaging } from "../shared/ipcChannels";
import { mediaContentTypeForPath } from "./fileResponse";

export type ImportIpcOptions = {
	ipcMain: {
		on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): unknown;
		removeListener(
			channel: string,
			listener: (event: IpcMainEvent, ...args: unknown[]) => void,
		): unknown;
	};
	/** Exact URL boundary check; see isUrlUnderPrefix. */
	isTrustedRendererUrl(url: string): boolean;
	/** Session root `_node_id` of the window behind a webContents, or null before it bootstrapped. */
	rootNodeIdOf(webContentsId: number): string | null;
	/** Stages the paths for that session root; returns the batch id or null when nothing was staged. */
	stage(rootNodeId: string, paths: readonly string[]): string | null;
};

/** UNC (`\\host\share`), device (`\\?\`, `\\.\`) and `//` network paths. */
const isNetworkOrDevicePath = (filePath: string): boolean =>
	filePath.startsWith("\\\\") || filePath.startsWith("//");

/**
 * Whether a path from a renderer may be imported: an absolute local path of a
 * video, audio or raster image file. Anything else is skipped, so a window
 * cannot make the host read network shares or arbitrary file types; the
 * media service still probes every accepted file.
 */
export const isImportablePath = (filePath: unknown): filePath is string =>
	typeof filePath === "string" &&
	path.isAbsolute(filePath) &&
	!isNetworkOrDevicePath(filePath) &&
	mediaContentTypeForPath(filePath) !== null;

/**
 * `minicut:import:stage` (synchronous) from the preload. The renderer sends
 * file paths obtained from `webUtils.getPathForFile`; a File object never
 * crosses IPC. Main stages them for the sending window's session and answers
 * with the batch id the window dispatches in `requestImportFiles`.
 */
export const registerImportIpc = ({
	ipcMain,
	isTrustedRendererUrl,
	rootNodeIdOf,
	stage,
}: ImportIpcOptions) => {
	const isTrusted = (event: IpcMainEvent): boolean => {
		const frame = event.senderFrame;
		return (
			Boolean(frame) &&
			frame === event.sender.mainFrame &&
			isTrustedRendererUrl(frame?.url ?? "")
		);
	};
	const onStage = (event: IpcMainEvent, paths: unknown): void => {
		let result: DesktopImportStaging;
		if (!isTrusted(event)) {
			result = { ok: false, reason: "untrusted sender" };
		} else if (!Array.isArray(paths)) {
			result = { ok: false, reason: "paths must be a list" };
		} else {
			const rootNodeId = rootNodeIdOf(event.sender.id);
			const accepted = paths.filter(isImportablePath);
			const batchId = rootNodeId && accepted.length > 0 ? stage(rootNodeId, accepted) : null;
			result = batchId
				? { ok: true, batchId, accepted: accepted.length }
				: {
						ok: false,
						reason: rootNodeId
							? "no video, audio or image file with a local path"
							: "the window has no session yet",
					};
		}
		event.returnValue = result;
	};
	ipcMain.on(ELECTRON_IPC.IMPORT_STAGE, onStage);
	return {
		dispose(): void {
			ipcMain.removeListener(ELECTRON_IPC.IMPORT_STAGE, onStage);
		},
	};
};
