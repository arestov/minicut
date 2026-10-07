import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEffectContractFakes } from "../../dkt/test/effectContractFakes";
import { startNodeMiniCutHost, type NodeMiniCutHost } from "./startNodeMiniCutHost";
import { connectNodeHostTestWindow, findModels } from "./testing/nodeHostDriver";

describe("opening a second window on a restored workspace", () => {
	let tempDir: string;
	let profileDir: string;
	const hosts: NodeMiniCutHost[] = [];

	const startHost = async () => {
		const host = await startNodeMiniCutHost({
			profileDir,
			effectInterfaces: createEffectContractFakes().interfaces,
		});
		hosts.push(host);
		return host;
	};

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "minicut-second-window-"));
		profileDir = path.join(tempDir, "profile");
	});

	afterEach(async () => {
		await Promise.all(hosts.splice(0).map((host) => host.dispose()));
		await rm(tempDir, { recursive: true, force: true });
	});

	it("does not re-apply stored state over live state or write duplicate CRDT batches", async () => {
		const first = await startHost();
		const seed = connectNodeHostTestWindow(first, "seed-window");
		await seed.bootstrap();
		await seed.dispatchAndSettle("createProject", { title: "Kept project" });
		await first.dispose();

		const second = await startHost();
		const windowOne = connectNodeHostTestWindow(second, "window-one");
		await windowOne.bootstrap();
		await windowOne.dispatchAndSettle("createProject", { title: "Edited in window one" });
		const beforeSecondWindow = await windowOne.readDump();

		const windowTwo = connectNodeHostTestWindow(second, "window-two");
		await windowTwo.bootstrap();
		const afterSecondWindow = await windowOne.readDump();

		expect(
			findModels(afterSecondWindow, "project").map((project) => project.attrs.title).sort(),
		).toEqual(
			findModels(beforeSecondWindow, "project").map((project) => project.attrs.title).sort(),
		);
		expect(afterSecondWindow.crdt?.durableLogCount).toBe(
			beforeSecondWindow.crdt?.durableLogCount,
		);
		expect(afterSecondWindow.crdt?.outboxCount).toBe(beforeSecondWindow.crdt?.outboxCount);
		// The only new model is the second window's own session root.
		const withoutSessionRoots = (dump: typeof afterSecondWindow) =>
			(dump.runtimeModels ?? []).filter((model) => model.modelName !== "session_root").length;
		expect(withoutSessionRoots(afterSecondWindow)).toBe(withoutSessionRoots(beforeSecondWindow));
		expect(findModels(afterSecondWindow, "session_root")).toHaveLength(
			findModels(beforeSecondWindow, "session_root").length + 1,
		);
	});
});
