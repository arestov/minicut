import type { ImportExecutor } from "../../../video-editor/hosts/desktop/importExecutor";

/** `promptForPaths` of the GPUIX renderer (the native path picker). */
export type PathPrompt = (options?: {
	files?: boolean;
	directories?: boolean;
	multiple?: boolean;
	prompt?: string;
}) => Promise<string[] | null>;

/**
 * Import service for the toolbar: native multi-file dialog, then the import
 * executor stages the paths and asks the model to import them. A cancelled
 * dialog does nothing.
 */
export const createImportFromDialog =
	(prompt: PathPrompt, importer: Pick<ImportExecutor, "requestImport">) =>
	async (): Promise<void> => {
		const paths = await prompt({
			files: true,
			multiple: true,
			prompt: "Import",
		});
		if (!paths || paths.length === 0) return;
		importer.requestImport(paths);
	};

type SyncWindowQuery = "getWindowSize" | "getWindowInsets" | "getElementBounds";
const SYNC_WINDOW_QUERIES: readonly SyncWindowQuery[] = ["getWindowSize", "getWindowInsets", "getElementBounds"];

/**
 * Renderer surface used by `createGuardedPathPrompt`. On Windows/Linux the
 * native window queries are synchronous round trips to the UI thread with a
 * 2 s timeout, and the native path picker keeps that thread inside its modal
 * loop. `@gpuix/solid` polls `getWindowSize` every 100 ms, so while the picker
 * is open every poll blocks the JS main thread for 2 s (the whole app
 * freezes in 2 s chunks until the picker closes).
 */
type PromptingRenderer = { promptForPaths: PathPrompt } & Partial<
	Record<SyncWindowQuery, (...args: never[]) => unknown>
>;

/**
 * Path prompt that answers the synchronous window queries from their last
 * value while the picker is open instead of asking the blocked UI thread.
 * Workaround for the native renderer; remove once it stops blocking.
 */
export const createGuardedPathPrompt = (renderer: PromptingRenderer): PathPrompt => {
	let pending = 0;
	const last = new Map<string, unknown>();
	for (const name of SYNC_WINDOW_QUERIES) {
		const query = renderer[name]?.bind(renderer) as ((...args: unknown[]) => unknown) | undefined;
		if (!query) continue;
		(renderer as Record<string, unknown>)[name] = (...args: unknown[]) => {
			const key = `${name}:${JSON.stringify(args)}`;
			if (pending > 0 && last.has(key)) return last.get(key);
			const value = query(...args);
			last.set(key, value);
			return value;
		};
	}
	const prompt = renderer.promptForPaths.bind(renderer);
	return async (options) => {
		pending += 1;
		try {
			return await prompt(options);
		} finally {
			pending -= 1;
		}
	};
};
