import type { ImportExecutor } from "./importExecutor";

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
