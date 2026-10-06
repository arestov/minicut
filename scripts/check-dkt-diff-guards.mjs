#!/usr/bin/env node
// Checks only lines added relative to a base ref, so pre-existing code does not block work.
// Usage: node scripts/check-dkt-diff-guards.mjs [baseRef=feat/desktop]
// Suppress a deliberate hit with a trailing comment: `// guard-ok: <reason>`.
import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "feat/desktop";

const isTest = (file) =>
	/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
	/\.testing\.[cm]?[jt]sx?$/.test(file) ||
	/(^|\/)(test|tests|__tests__)\//.test(file);
const isSource = (file) => /\.[cm]?[jt]sx?$/.test(file);
const isModel = (file) => file.startsWith("src/video-editor/models/");
const isSyncLib = (file) => /^src\/dkt-(react|ui|solid)-sync\//.test(file);

const rules = [
	{
		id: "model-impure-clock-or-random",
		applies: (file) => isModel(file) && !isTest(file),
		pattern: /\b(Date\.now|performance\.now|Math\.random)\s*\(|\bnew Date\s*\(/,
		message: "time/randomness inside models: use $meta$time, $now/$meta$timestamp or ids from payload",
	},
	{
		id: "instance-state-read",
		applies: (file) => file.startsWith("src/") && isSource(file) && !isTest(file) && !isSyncLib(file),
		pattern: /\.getAttr\s*\(|\.attrs\??\.[A-Za-z_$]|\._states\b/,
		message: "model instance used as a data API: read through declared deps",
	},
	{
		id: "source-id-backbone",
		applies: (file) => file.startsWith("src/") && isSource(file) && !isTest(file),
		pattern: /\bsource(Project|Track|Resource|Clip|Text|Effect)Id\b|\bsourceResourceName\b/,
		message: "source-id traversal: use _node_id and owner rels",
	},
	{
		id: "replica-read-helpers",
		applies: (file) => file.startsWith("src/") && isSource(file) && !isTest(file) && !isSyncLib(file),
		pattern: /\b(readOne|readMany|readAttrs)\s*\(/,
		message: "replica read helpers outside sync libraries",
	},
	{
		id: "test-timing-magic",
		applies: (file) => isTest(file) && isSource(file),
		pattern: /\bsetTimeout\s*\(|\bqueueMicrotask\s*\(|\bwaitFlow\s*\(|\bwaitForTimeout\s*\(|\bsleep\s*\(/,
		message: "timing tricks in tests: wait for explicit outcome, read in a separate step",
	},
];

const diff = execFileSync(
	"git",
	["diff", "--unified=0", "--no-color", `${base}...HEAD`],
	{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

const hits = [];
let file = null;
let line = 0;
for (const raw of diff.split("\n")) {
	if (raw.startsWith("+++ ")) {
		file = raw.startsWith("+++ b/") ? raw.slice(6) : null;
		continue;
	}
	const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
	if (hunk) {
		line = Number(hunk[1]);
		continue;
	}
	if (!file || raw.startsWith("---")) continue;
	if (raw.startsWith("+")) {
		const text = raw.slice(1);
		if (!/guard-ok:/.test(text)) {
			for (const rule of rules) {
				if (rule.applies(file) && rule.pattern.test(text)) {
					hits.push(`${file}:${line} [${rule.id}] ${rule.message}\n    ${text.trim()}`);
				}
			}
		}
		line += 1;
	}
}

if (hits.length > 0) {
	console.error(`DKT diff guards: ${hits.length} hit(s) vs ${base}\n`);
	console.error(hits.join("\n"));
	process.exit(1);
}
console.log(`DKT diff guards passed vs ${base}.`);
