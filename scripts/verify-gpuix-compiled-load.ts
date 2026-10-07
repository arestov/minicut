// Verifies that GPUIX packages load inside a `bun build --compile` executable
// started from an empty directory (no node_modules, no window opened).
//
//   bun scripts/verify-gpuix-compiled-load.ts
//
// Findings (see docs/bun-desktop-host-binary.md): the CJS entry of @gpuix/native
// embeds its .node binding; the ESM entry (`import ... from "@gpuix/native"`) uses
// createRequire and does NOT, so a compiled app must `require` it or ship
// gpuix-native.<target>.node beside the executable (this script is win32-x64 only).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(path.join(tmpdir(), "gpuix-compiled-"));
let failed = false;
try {
	for (const name of ["native-cjs", "solid-esm"]) {
		const exe = path.join(out, `${name}.exe`);
		const build = await Bun.build({
			entrypoints: [path.join(repoRoot, "scripts/gpuix-compiled-load", `${name}.ts`)],
			compile: { outfile: exe },
			target: "bun",
		});
		if (!build.success) {
			console.error(`build ${name} failed`, build.logs.map(String).join("\n"));
			failed = true;
			continue;
		}
		// ESM path: the binding must sit beside the executable.
		if (name === "solid-esm") {
			const file = "gpuix-native.win32-x64-msvc.node";
			copyFileSync(path.join(repoRoot, "node_modules/@gpuix/native-win32-x64-msvc", file), path.join(out, file));
		}
		const run = spawnSync(exe, [], { cwd: out, encoding: "utf8" });
		const ok = run.status === 0;
		failed ||= !ok;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${(run.stdout || run.stderr).trim().split("\n")[0]}`);
	}
} finally {
	rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
