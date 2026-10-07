// Compiles the headless desktop host probe into a single executable with Bun.
//
//   bun scripts/build-desktop-host.ts [--outdir <dir>]      (default: tmp/desktop-host)
//
// `bun build --compile` has no plugin flag, so the `dkt` / `dkt-all` aliases are
// supplied through the Bun.build API. The classic-level addon needs no sidecar:
// Bun embeds the .node file found by node-gyp-build into the executable and
// extracts it at run time (verified by running the exe alone in an empty dir).
// ffmpeg/ffprobe are located via MINICUT_FFMPEG_PATH /
// MINICUT_FFPROBE_PATH or PATH (see src/video-editor/media/node/binaries.ts).
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDktAliasPath } from "./dktAliases.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outIndex = process.argv.indexOf("--outdir");
const outdir = path.resolve(
	outIndex >= 0 ? process.argv[outIndex + 1] : path.join(repoRoot, "tmp", "desktop-host"),
);
const exeName = process.platform === "win32" ? "minicut-host.exe" : "minicut-host";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
	entrypoints: [path.join(repoRoot, "src/video-editor/adapters/node/desktopHostProbe.ts")],
	compile: { outfile: path.join(outdir, exeName) },
	target: "bun",
	plugins: [
		{
			name: "dkt-alias",
			setup(build) {
				build.onResolve({ filter: /^dkt(-all)?(\/|$)/ }, ({ path: specifier }) => {
					const target = resolveDktAliasPath(specifier);
					return target ? { path: Bun.resolveSync(target, "/") } : undefined;
				});
			},
		},
	],
});
if (!result.success) {
	for (const message of result.logs) console.error(String(message));
	process.exit(1);
}

console.log(`built ${path.join(outdir, exeName)}`);
