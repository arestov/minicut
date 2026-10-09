import { expect, test } from "bun:test";
import { createGuardedPathPrompt, createImportFromDialog } from "./nativeDialogs";

test("passes the picked paths to the import executor", async () => {
	const staged: string[][] = [];
	const importFromDialog = createImportFromDialog(
		async (options) => {
			expect(options).toMatchObject({ files: true, multiple: true });
			return ["/media/a.mp4", "/media/b.wav"];
		},
		{
			requestImport(paths) {
				staged.push([...paths]);
				return "batch";
			},
		},
	);

	await importFromDialog();

	expect(staged).toEqual([["/media/a.mp4", "/media/b.wav"]]);
});

test("a cancelled dialog imports nothing", async () => {
	let calls = 0;
	const importFromDialog = createImportFromDialog(async () => null, {
		requestImport() {
			calls += 1;
			return null;
		},
	});

	await importFromDialog();

	expect(calls).toBe(0);
});

test("window queries are not forwarded to the native renderer while the path picker is open", async () => {
	let nativeQueries = 0;
	let finishPicker: (paths: string[] | null) => void = () => {};
	const renderer = {
		getWindowSize: () => {
			nativeQueries += 1;
			return { width: 1280, height: 800 };
		},
		promptForPaths: () => new Promise<string[] | null>((resolve) => (finishPicker = resolve)),
	};
	const prompt = createGuardedPathPrompt(renderer);

	expect(renderer.getWindowSize()).toEqual({ width: 1280, height: 800 });
	expect(nativeQueries).toBe(1);

	const picked = prompt({ files: true });
	expect(renderer.getWindowSize()).toEqual({ width: 1280, height: 800 });
	expect(renderer.getWindowSize()).toEqual({ width: 1280, height: 800 });
	expect(nativeQueries).toBe(1);

	finishPicker(["/media/a.mp4"]);
	expect(await picked).toEqual(["/media/a.mp4"]);
	renderer.getWindowSize();
	expect(nativeQueries).toBe(2);
});

test("window queries are forwarded again when the picker is cancelled or fails", async () => {
	let nativeQueries = 0;
	const renderer = {
		getWindowSize: () => {
			nativeQueries += 1;
			return { width: 1, height: 1 };
		},
		promptForPaths: async () => {
			throw new Error("no UI thread");
		},
	};
	const prompt = createGuardedPathPrompt(renderer);
	renderer.getWindowSize();
	await expect(prompt()).rejects.toThrow("no UI thread");
	renderer.getWindowSize();
	expect(nativeQueries).toBe(2);
});
