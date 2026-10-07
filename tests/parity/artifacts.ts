import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FILE, type ParityManifest, type ParityPlatform } from "./sharedScenario";

/** Both platform runs write here (gitignored), the comparison reads from here. */
export const PARITY_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../tmp/parity",
);

export const parityDirectory = (platform: ParityPlatform): string => path.join(PARITY_ROOT, platform);

/** Empties and recreates the platform directory at the start of a run. */
export const resetParityDirectory = (platform: ParityPlatform): string => {
	const directory = parityDirectory(platform);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	return directory;
};

export const writeManifest = (manifest: ParityManifest): void => {
	writeFileSync(
		path.join(parityDirectory(manifest.platform), MANIFEST_FILE),
		JSON.stringify(manifest, null, 2),
	);
};

export const readManifest = (platform: ParityPlatform): ParityManifest => {
	const file = path.join(parityDirectory(platform), MANIFEST_FILE);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as ParityManifest;
	} catch (error) {
		throw new Error(
			`No ${platform} parity artifacts at ${file}; run the ${platform} side first (npm run -s test:parity). ${String(error)}`,
		);
	}
};
