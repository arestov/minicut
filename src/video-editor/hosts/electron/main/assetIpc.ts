import type { IpcMainEvent } from "electron";
import type { HostAssetRegistry } from "./assetRegistry";
import {
	createAssetUrl,
	ELECTRON_IPC,
	type DesktopAssetRegistration,
} from "../shared/ipcChannels";

export type AssetIpcOptions = {
	assets: HostAssetRegistry;
	ipcMain: {
		on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): unknown;
		removeListener(
			channel: string,
			listener: (event: IpcMainEvent, ...args: unknown[]) => void,
		): unknown;
	};
	/** Exact URL boundary check; see isUrlUnderPrefix. */
	isTrustedRendererUrl(url: string): boolean;
};

/**
 * `minicut:asset:register` (synchronous) and `minicut:asset:release` from
 * the preload. The renderer sends a file path obtained from
 * `webUtils.getPathForFile`; a File object never crosses IPC.
 *
 * Assets belong to the webContents that registered them and are released
 * when it is destroyed or its main frame navigates (reload).
 */
export const registerAssetIpc = ({
	assets,
	ipcMain,
	isTrustedRendererUrl,
}: AssetIpcOptions) => {
	const isTrusted = (event: IpcMainEvent): boolean => {
		const frame = event.senderFrame;
		return (
			Boolean(frame) &&
			frame === event.sender.mainFrame &&
			isTrustedRendererUrl(frame?.url ?? "")
		);
	};
	const observed = new Map<number, () => void>();
	const observe = (sender: IpcMainEvent["sender"]): void => {
		if (observed.has(sender.id)) return;
		const ownerId = sender.id;
		const onDestroyed = () => {
			assets.releaseOwner(ownerId);
			stop();
		};
		const onNavigation = (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
			if (details.isMainFrame && !details.isSameDocument) {
				assets.releaseOwner(ownerId);
			}
		};
		const stop = () => {
			sender.off("destroyed", onDestroyed);
			sender.off("did-start-navigation", onNavigation as never);
			observed.delete(ownerId);
		};
		sender.on("destroyed", onDestroyed);
		sender.on("did-start-navigation", onNavigation as never);
		observed.set(ownerId, stop);
	};
	const onRegister = (event: IpcMainEvent, filePath: unknown): void => {
		let result: DesktopAssetRegistration;
		if (!isTrusted(event)) {
			result = { ok: false, reason: "untrusted sender" };
		} else {
			const registered = assets.register(filePath, event.sender.id);
			if (registered.ok) {
				observe(event.sender);
			}
			result = registered.ok
				? {
						ok: true,
						assetId: registered.assetId,
						url: createAssetUrl(registered.assetId),
						name: registered.name,
						size: registered.size,
					}
				: registered;
		}
		event.returnValue = result;
	};
	const onRelease = (event: IpcMainEvent, assetId: unknown): void => {
		if (isTrusted(event) && typeof assetId === "string") {
			assets.release(assetId, event.sender.id);
		}
	};
	ipcMain.on(ELECTRON_IPC.ASSET_REGISTER, onRegister);
	ipcMain.on(ELECTRON_IPC.ASSET_RELEASE, onRelease);
	return {
		dispose(): void {
			ipcMain.removeListener(ELECTRON_IPC.ASSET_REGISTER, onRegister);
			ipcMain.removeListener(ELECTRON_IPC.ASSET_RELEASE, onRelease);
			for (const stop of [...observed.values()]) stop();
		},
	};
};
