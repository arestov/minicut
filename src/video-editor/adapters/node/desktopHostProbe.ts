import path from "node:path";
import type { MiniCutEffectInterfaces } from "../../core/contracts/effectInterfaces";
import { resolveMediaBinaries } from "../../media/node/binaries";
import { runCli } from "../../media/node/cli";
import { startNodeMiniCutHost } from "./startNodeMiniCutHost";
import { connectNodeHostTestWindow, findModels } from "./testing/nodeHostDriver";

/**
 * Headless desktop host probe entry, compiled by `scripts/build-desktop-host.ts`.
 * It exists to prove that the Node host (DKT + LevelDB) and the media service
 * CLI run from a single Bun-compiled binary. It is not the product host:
 * the effect interfaces below are explicit probe stubs that only count calls
 * (opening, restoring or creating a project triggers playbackRuntime only).
 *
 *   host where
 *   host workspace --profile <dir> [--create-project <title>]
 *   host media <probe|capabilities|export|proxy ...>   (same as media/node/cli.ts)
 */
const effectCalls: Record<string, number> = {};

function probeStub(name: string) {
	return (): void => {
		effectCalls[name] = (effectCalls[name] ?? 0) + 1;
	};
}

const probeEffectInterfaces: MiniCutEffectInterfaces = {
	exportRuntime: { requestExport: probeStub("exportRuntime.requestExport") },
	importRuntime: { requestImportFiles: probeStub("importRuntime.requestImportFiles") },
	mediaRecoveryRuntime: { requestMediaRecovery: probeStub("mediaRecoveryRuntime.requestMediaRecovery") },
	playbackRuntime: { applyPlaybackRun: probeStub("playbackRuntime.applyPlaybackRun") },
};

const flag = (args: string[], name: string): string | undefined => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};

const runtimeName = (): string =>
	process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

const main = async (argv: string[]): Promise<number> => {
	const [command, ...rest] = argv;
	if (command === "where") {
		console.log(
			JSON.stringify(
				{
					runtime: runtimeName(),
					execPath: process.execPath,
					cwd: process.cwd(),
					binaries: resolveMediaBinaries(),
				},
				null,
				2,
			),
		);
		return 0;
	}
	if (command === "media") {
		const { exitCode, result } = await runCli(rest);
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return exitCode;
	}
	if (command === "workspace") {
		const profileDir = flag(rest, "--profile");
		if (!profileDir) throw new Error("workspace requires --profile <dir>");
		const title = flag(rest, "--create-project");
		const host = await startNodeMiniCutHost({
			profileDir: path.resolve(profileDir),
			effectInterfaces: probeEffectInterfaces,
		});
		try {
			const window = connectNodeHostTestWindow(host);
			await window.bootstrap();
			if (title) await window.dispatchAndSettle("createProject", { title });
			const dump = await window.readDump();
			console.log(
				JSON.stringify(
					{
						runtime: runtimeName(),
						identity: host.identity,
						projects: findModels(dump, "project").map(({ attrs: { title } }) => title),
						effectCalls,
						crdt: {
							peerId: dump.crdt?.peerId,
							outboxCount: dump.crdt?.outboxCount,
							durableLogCount: dump.crdt?.durableLogCount,
						},
					},
					null,
					2,
				),
			);
		} finally {
			await host.dispose();
		}
		return 0;
	}
	throw new Error(`Unknown command: ${command ?? "<none>"} (where|workspace|media)`);
};

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error) => {
		console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
		process.exit(1);
	},
);
