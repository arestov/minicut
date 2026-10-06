import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script shared with Vite, Node loader and Bun
import * as aliases from "../../../scripts/dktAliases.mjs";

const repoRoot = path.resolve(__dirname, "../../..");

describe("DKT alias resolution", () => {
	it("maps dkt and dkt-all specifiers into the DKT checkout", () => {
		expect(aliases.resolveDktAliasPath("dkt")).toBe(aliases.DKT_PROVODA_ROOT);
		expect(aliases.resolveDktAliasPath("dkt/crdt/storage/leveldb.js")).toBe(
			path.join(aliases.DKT_PROVODA_ROOT, "crdt/storage/leveldb.js"),
		);
		expect(aliases.resolveDktAliasPath("dkt-all")).toBe(aliases.DKT_ROOT);
		expect(
			aliases.resolveDktAliasPath("dkt-all/libs/provoda/crdt/index.js"),
		).toBe(path.join(aliases.DKT_ROOT, "libs/provoda/crdt/index.js"));
		expect(aliases.resolveDktAliasPath("dktx/foo")).toBeNull();
		expect(aliases.resolveDktAliasPath("react")).toBeNull();
	});

	it("keeps tsconfig paths in sync with the shared aliases", () => {
		const tsconfig = JSON.parse(
			readFileSync(path.join(repoRoot, "tsconfig.video-editor.json"), "utf8"),
		) as { compilerOptions: { paths: Record<string, string[]> } };
		const relative = (absolute: string) =>
			path.relative(repoRoot, absolute).split(path.sep).join("/");
		const { paths } = tsconfig.compilerOptions;
		expect(paths.dkt).toEqual([relative(aliases.DKT_PROVODA_ROOT)]);
		expect(paths["dkt/*"]).toEqual([`${relative(aliases.DKT_PROVODA_ROOT)}/*`]);
		expect(paths["dkt-all"]).toEqual([relative(aliases.DKT_ROOT)]);
		expect(paths["dkt-all/*"]).toEqual([`${relative(aliases.DKT_ROOT)}/*`]);
	});
});
