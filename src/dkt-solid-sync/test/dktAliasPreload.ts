import { plugin } from "bun";
import { resolveDktAliasPath } from "../../../scripts/dktAliases.mjs";

plugin({
	name: "dkt-alias",
	setup(build) {
		build.onResolve({ filter: /^dkt(-all)?(\/|$)/ }, ({ path: specifier }) => {
			const target = resolveDktAliasPath(specifier);
			return target ? { path: Bun.resolveSync(target, "/") } : undefined;
		});
	},
});
