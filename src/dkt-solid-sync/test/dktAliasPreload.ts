import path from "node:path";
import { fileURLToPath } from "node:url";
import { plugin } from "bun";

const dktRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../tmp/dkt/js",
);
const dktProvodaRoot = path.join(dktRoot, "libs/provoda/provoda");

const mapAlias = (specifier: string): string | null => {
	if (specifier === "dkt") return dktProvodaRoot;
	if (specifier.startsWith("dkt/")) {
		return path.join(dktProvodaRoot, specifier.slice("dkt/".length));
	}
	if (specifier === "dkt-all") return dktRoot;
	if (specifier.startsWith("dkt-all/")) {
		return path.join(dktRoot, specifier.slice("dkt-all/".length));
	}
	return null;
};

plugin({
	name: "dkt-alias",
	setup(build) {
		build.onResolve({ filter: /^dkt(-all)?(\/|$)/ }, ({ path: specifier }) => {
			const target = mapAlias(specifier);
			return target ? { path: Bun.resolveSync(target, "/") } : undefined;
		});
	},
});
