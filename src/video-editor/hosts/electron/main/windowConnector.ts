import type { IpcMainEvent, WebContents } from "electron";
import {
	createElectronMainPortTransport,
	type ElectronMainPortLike,
} from "../../../adapters/transport/electron/createElectronMainPortTransport";
import type { NodeMiniCutHost } from "../../../adapters/node/startNodeMiniCutHost";
import {
	ELECTRON_IPC,
	type DesktopHandshakeReply,
} from "../shared/ipcChannels";

export type MessageChannelLike = {
	port1: ElectronMainPortLike;
	port2: unknown;
};

export type WindowConnectorOptions = {
	runtime: Pick<NodeMiniCutHost["runtime"], "connect">;
	/** Room key of the local workspace; every window uses the same one. */
	sessionKey: string;
	createMessageChannel(): MessageChannelLike;
	ipcMain: {
		on(channel: string, listener: (event: IpcMainEvent) => void): unknown;
		removeListener(
			channel: string,
			listener: (event: IpcMainEvent) => void,
		): unknown;
	};
	/** Only pages that return true may open a DKT channel. */
	isTrustedRendererUrl(url: string): boolean;
};

/** Window session id: stable for a webContents, never reused within a run. */
export const createWindowSessionId = (
	sessionKey: string,
	webContentsId: number,
): string => `${sessionKey}:window:${webContentsId}`;

const postHandshake = (
	sender: WebContents,
	message: DesktopHandshakeReply,
	ports: unknown[],
): void => {
	sender.postMessage(ELECTRON_IPC.PORT, message, ports as never[]);
};

/**
 * Answers `minicut:connect` from the preload: opens a MessageChannelMain,
 * connects the main end to the shared runtime as one window stream and hands
 * the renderer end to the page together with the window's session ids.
 */
export const createWindowConnector = ({
	runtime,
	sessionKey,
	createMessageChannel,
	ipcMain,
	isTrustedRendererUrl,
}: WindowConnectorOptions) => {
	const onConnect = (event: IpcMainEvent): void => {
		const sender = event.sender;
		const frame = event.senderFrame;
		if (
			!frame ||
			frame !== sender.mainFrame ||
			!isTrustedRendererUrl(frame.url)
		) {
			return;
		}
		const sessionId = createWindowSessionId(sessionKey, sender.id);
		const { port1, port2 } = createMessageChannel();
		try {
			const transport = createElectronMainPortTransport(port1);
			runtime.connect(transport);
		} catch (error) {
			postHandshake(
				sender,
				{
					error: error instanceof Error ? error.message : String(error),
				},
				[],
			);
			return;
		}
		postHandshake(
			sender,
			{ sessionKey, sessionId },
			[port2],
		);
	};

	ipcMain.on(ELECTRON_IPC.CONNECT, onConnect);
	return {
		dispose(): void {
			ipcMain.removeListener(ELECTRON_IPC.CONNECT, onConnect);
		},
	};
};
