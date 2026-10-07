/**
 * Headless clip-seeding benchmark: boots the real MiniCut DKT runtime in this
 * process (memory storage), creates a project and adds N clips with `addClip`
 * (one dispatchAndWait at a time), recording per-add time.
 *
 * Run:
 *   TSX_TSCONFIG_PATH=tsconfig.video-editor.json node --conditions=browser --import tsx scripts/perf/bench-add-clip.ts \
 *     [--n=50,100,200,400] [--crdt=on|off] [--sync=on|off] [--out=file.json]
 *   (add `--cpu-prof --cpu-prof-dir=...` to profile; `--conditions=browser` is required so solid-js effects run)
 *
 * --crdt=off  runtime without CRDT engine.
 * --sync=off  the runtime still builds sync messages, but the page-side sync
 *             receiver never sees SYNC_HANDLE messages (acks still flow).
 *
 * Each N runs in a fresh runtime; clips alternate over the 3 default-ish lanes
 * exactly like the `large` GPUIX scenario (V1, V2, A1).
 */
import { writeFileSync } from "node:fs";
import type { DomSyncTransportLike } from "dkt/dom-sync/transport.js";
import { createMiniCutDktRuntime } from "../../src/video-editor/dkt/runtime/createMiniCutDktRuntime";
import { createMiniCutPageSyncRuntime } from "../../src/video-editor/dkt/runtime/createMiniCutPageSyncRuntime";
import { DKT_MSG, type MiniCutDktTransportMessage } from "../../src/video-editor/dkt/shared/messageTypes";
import { createEffectContractFakes } from "../../src/video-editor/dkt/test/effectContractFakes";
import { createScenarioDriver } from "../../src/ui/gpuix/fixtures/scenarioDriver";

type Message = MiniCutDktTransportMessage;
const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const [k, v] = a.replace(/^--/, "").split("=");
		return [k, v ?? "true"];
	}),
);
const sizes = (args.n ?? "50,100,200,400").split(",").map(Number);
const crdtOn = (args.crdt ?? "on") !== "off";
const syncOn = (args.sync ?? "on") !== "off";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2"];

const runOne = async (total: number) => {
	const fakes = createEffectContractFakes();
	const runtime = createMiniCutDktRuntime({
		enabled: true,
		effectInterfaces: fakes.interfaces,
		crdt: crdtOn
			? { enabled: true, testOnly: true, storage: "memory", transport: null }
			: undefined,
	});
	let muted = false;
	const pageL = new Set<(m: Message) => void>();
	const rtL = new Set<(m: Message) => void>();
	const mk = (
		inbox: Set<(m: Message) => void>,
		outbox: Set<(m: Message) => void>,
		isRuntimeSide: boolean,
	): DomSyncTransportLike<Message> => ({
		send(message) {
			if (isRuntimeSide && muted && message.type === DKT_MSG.SYNC_HANDLE) return;
			for (const l of [...outbox]) l(message);
		},
		listen(l) {
			inbox.add(l);
			return () => inbox.delete(l);
		},
		destroy() {
			inbox.clear();
		},
	});
	const connection = runtime.connect(mk(rtL, pageL, true));
	const pageRuntime = createMiniCutPageSyncRuntime({ transport: mk(pageL, rtL, false) });
	pageRuntime.bootstrap({ sessionKey: "bench" });
	const driver = createScenarioDriver(pageRuntime);
	const root = await driver.root();
	await driver.run("createProject", { title: "Bench" });
	const project = await driver.waitOne(root, "activeProject");
	const tracks = await driver.waitMany(project, "tracks", 2);
	await driver.run("addTrack", { kind: "video", name: "V2" }, project);
	const all = await driver.waitMany(project, "tracks", 3);
	const lanes = [
		{ track: tracks[0], kind: "video", count: 0 },
		{ track: all[2], kind: "video", count: 0 },
		{ track: tracks[1], kind: "audio", count: 0 },
	] as const;
	muted = !syncOn;
	const times: number[] = [];
	const t0 = performance.now();
	for (let i = 0; i < total; i++) {
		const lane = lanes[i % 3];
		const slot = (lane as { count: number }).count++;
		const s = performance.now();
		await pageRuntime.dispatchAndWait(
			"addClip",
			{
				name: `Clip ${i + 1}`,
				mediaKind: lane.kind,
				start: slot * 2.5,
				in: 0,
				duration: 2.25,
				color: COLORS[i % COLORS.length],
			},
			lane.track,
		);
		// dispatchAndWait resolves on "accepted"; the model work is only done once the runtime is idle.
		await (pageRuntime as unknown as { waitForRuntimeSettled(): Promise<void> }).waitForRuntimeSettled();
		times.push(performance.now() - s);
	}
	const totalMs = performance.now() - t0;
	driver.destroy();
	pageRuntime.destroy();
	connection.destroy();
	await runtime.dispose?.();
	return { total, totalMs, times };
};

// least-squares fit of cumulative-per-add time: t(i) = a + b*i (+ c*i^2)
const fit = (times: number[]) => {
	const n = times.length;
	const sm = (f: (i: number) => number) => times.reduce((s, t, i) => s + f(i) * t, 0);
	const sx = (n * (n - 1)) / 2;
	const sxx = ((n - 1) * n * (2 * n - 1)) / 6;
	const sy = times.reduce((s, t) => s + t, 0);
	const sxy = sm((i) => i);
	const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
	const a = (sy - b * sx) / n;
	return { perAddAtStartMs: a, perAddGrowthMsPerClip: b };
};

const results: unknown[] = [];
console.log(`crdt=${crdtOn ? "on" : "off"} sync=${syncOn ? "on" : "off"}`);
for (const n of sizes) {
	const r = await runOne(n);
	const q = (f: number) => r.times[Math.floor(r.times.length * f)] ;
	const first = r.times.slice(0, Math.min(10, n)).reduce((s, t) => s + t, 0) / Math.min(10, n);
	const last = r.times.slice(-10).reduce((s, t) => s + t, 0) / Math.min(10, n);
	const f = fit(r.times);
	const row = {
		n,
		totalMs: Math.round(r.totalMs),
		meanMs: +(r.totalMs / n).toFixed(2),
		firstTenAvgMs: +first.toFixed(2),
		lastTenAvgMs: +last.toFixed(2),
		p50: +q(0.5).toFixed(2),
		...f,
	};
	results.push(row);
	console.log(JSON.stringify(row));
}
if (args.out) writeFileSync(args.out, JSON.stringify({ crdtOn, syncOn, results }, null, 1));
// Optional: a locally instrumented DKT may publish globalThis.__fpStats (Map<string,{n,bytes}>).
const fpStats = (globalThis as { __fpStats?: Map<string, { n: number; bytes: number }> }).__fpStats;
if (fpStats) {
	const rows = [...fpStats].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15);
	for (const [k, v] of rows) console.log(`${k} n=${v.n} bytes=${v.bytes}`);
}
process.exit(0);
