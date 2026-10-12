import { afterEach, expect, test } from "bun:test";
import type { MiniCutEffectInterfaces } from "../../../video-editor/core/contracts/effectInterfaces";
import { createInProcessDkt, type InProcessDkt } from "./createInProcessDkt";

let dkt: InProcessDkt | null = null;

afterEach(() => {
	dkt?.destroy();
	dkt = null;
});

const whenReady = (pageRuntime: InProcessDkt["pageRuntime"]) =>
	new Promise<void>((resolve) => {
		const check = () => {
			if (pageRuntime.getSnapshot().ready) {
				unsubscribe();
				resolve();
			}
		};
		const unsubscribe = pageRuntime.subscribe(check);
		check();
	});

test("boots the real DKT runtime on memory storage and syncs the root", async () => {
	dkt = createInProcessDkt();

	await whenReady(dkt.pageRuntime);

	const snapshot = dkt.pageRuntime.getSnapshot();
	expect(snapshot.booted).toBe(true);
	expect(snapshot.rootNodeId).toEqual(expect.any(String));
	expect(snapshot.runtimeError).toBeNull();
});

test("runs on the effect contract fakes unless the host supplies its own interfaces", async () => {
	dkt = createInProcessDkt();
	expect(dkt.fakes).not.toBeNull();
	await whenReady(dkt.pageRuntime);
	dkt.destroy();

	const own = {
		exportRuntime: { requestExport() {}, cancelExport() {} },
		importRuntime: { requestImportFiles() {} },
		mediaRecoveryRuntime: { requestMediaRecovery() {}, publishMediaPublicationDecision() {}, releaseMediaPublication() {} },
		playbackRuntime: { applyPlaybackRun() {} },
	};
	dkt = createInProcessDkt({ effectInterfaces: own });
	expect(dkt.fakes).toBeNull();
	await whenReady(dkt.pageRuntime);
});

test("an incomplete interface set is a startup error", () => {
	expect(() =>
		createInProcessDkt({ effectInterfaces: {} as MiniCutEffectInterfaces }),
	).toThrow();
});
