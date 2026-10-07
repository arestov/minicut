import { expect, test } from "bun:test";
import { createImportFromDialog } from "./nativeDialogs";

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
