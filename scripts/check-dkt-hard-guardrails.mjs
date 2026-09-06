import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const roots = [
  'src/video-editor/app',
  'src/video-editor/components',
  'src/video-editor/models',
  'src/video-editor/render',
  'src/video-editor/p2p',
  'src/video-editor/worker',
].filter((root) => existsSync(root))

// Running editor path must use DKT node identity only.
// Do not route mutations by source ids or by matching domain attrs.
// Existing model refs should be passed as refs or resolved through $input_id.
const checks = [
	{
		name: 'Removed rels.sel declaration',
		pattern: "[\"']sel[\"']",
		extraArgs: ['-g', '*.ts'],
		contractRoots: ['src/video-editor/models'],
	},
	{
		name: 'Legacy app model relation declaration',
		pattern: "\\[\\s*[\"']model[\"']",
		extraArgs: ['-g', '*.ts'],
		contractRoots: ['src/video-editor/models'],
	},
	{
		name: 'Promise-style raw DKT storage request',
		pattern: '\\bdktStorage\\.(getSnapshot|getManifest|getSchema|commitChanges|whenReady)\\s*\\(',
		extraArgs: ['-g', '*.ts'],
		contractRoots: ['src/video-editor/dkt'],
	},
  {
    name: 'Legacy registry API usage in app/runtime path',
    pattern: 'ProjectRegistry|projects\\$|session\\$|createProjectsStore|createSessionStore|authority\\.dispatch',
    extraArgs: [],
  },
  {
    name: 'Legacy DKT message constants in running path',
    pattern: 'DKT_MSG\\.(GET_SNAPSHOT|REPLACE_SNAPSHOT|DISPATCH_COMMAND|PATCHES|DISPATCH_RESULT)',
    extraArgs: [],
  },
  {
    name: 'Legacy render/runtime debug compatibility symbols',
    pattern: 'DktRegistryRenderStore|createDktEditorRenderRuntime|legacyRuntime|debugDumpGraph|debugDescribeNode',
    extraArgs: [],
  },
  {
    name: 'Legacy source-id identity usage in running path',
    pattern: 'source(Project|Track|Resource|Clip|Text|Effect)Id|sourceResourceName',
    extraArgs: [],
  },
  {
    name: 'Attribute lookup routing in running path',
    pattern: 'find[A-Za-z0-9_]*ByAttrs?|lookup[A-Za-z0-9_]*ByAttrs?|resolve[A-Za-z0-9_]*ByAttrs?',
    extraArgs: [],
  },
  {
    name: 'No-op legacy contract stubs',
    pattern: 'No-op: legacy|Registry-based authority contract removed|runAuthorityClientContract',
    extraArgs: [],
  },
]

const excludeGlobs = [
  '-g', '!**/*.test.ts',
  '-g', '!**/*.test.tsx',
  '-g', '!**/*.testing.ts',
  '-g', '!**/testing/**',
  '-g', '!**/__tests__/**',
  '-g', '!**/domain/**',
  '-g', '!**/dkt/state/**',
  '-g', '!**/worker/sharedWorker.ts',
  '-g', '!**/worker/sharedWorkerClient.ts',
  '-g', '!**/worker/derivedIndexes.ts',
]

const violations = []

const mediaRecoveryGuards = [
	{ name: 'Import recovery must not read model state', pattern: '\\b(readAttrs|waitForImportedResource|resolveImportedResource)\\b', roots: ['src/video-editor/app/importFilesTaskExecutor.ts'] },
	{ name: 'Import recovery must not patch Resource after creation', pattern: '["\']setResourceAttrs["\']', roots: ['src/video-editor/app/importFilesTaskExecutor.ts'] },
]

for (const check of mediaRecoveryGuards) {
	const res = spawnSync('rg', ['-n', '--color', 'never', '-S', check.pattern, ...check.roots], { encoding: 'utf8' })
	if (res.status === 0) violations.push({ check: check.name, output: res.stdout.trim() })
	else if (res.status !== 1) process.exit(2)
}

for (const check of checks) {
	const checkRoots = check.contractRoots || roots
	const args = ['-n', '--color', 'never', '-S', check.pattern, ...excludeGlobs, ...check.extraArgs, ...checkRoots]
  const res = spawnSync('rg', args, { encoding: 'utf8' })

  if (res.error) {
    console.error(`[guardrails] failed to run rg: ${res.error.message}`)
    process.exit(2)
  }

  if (res.status === 0) {
    violations.push({ check: check.name, output: res.stdout.trim() })
  } else if (res.status !== 1) {
    console.error(`[guardrails] rg exited with status ${res.status} for check: ${check.name}`)
    console.error(res.stderr)
    process.exit(2)
  }
}

const globalAstGrepCli = process.env.APPDATA
	? join(process.env.APPDATA, 'npm', 'node_modules', '@ast-grep', 'cli', 'ast-grep')
	: null
const localAstGrepCli = join('node_modules', '@ast-grep', 'cli', 'ast-grep')
const astGrepCli = existsSync(localAstGrepCli)
	? localAstGrepCli
	: globalAstGrepCli && existsSync(globalAstGrepCli)
		? globalAstGrepCli
		: null

if (!astGrepCli) {
	console.error('[guardrails] ast-grep CLI is required for structural DKT checks')
	process.exit(2)
}

const astGrep = spawnSync(
	process.execPath,
	[
		astGrepCli,
		'scan',
		'--rule',
		'scripts/dkt-guard-rules.yml',
		'--report-style',
		'short',
		'src/video-editor/models',
		'src/video-editor/dkt',
	],
	{ encoding: 'utf8' },
)

if (astGrep.error) {
	console.error(`[guardrails] failed to run ast-grep: ${astGrep.error.message}`)
	process.exit(2)
}
if (astGrep.status === 1) {
	violations.push({
		check: 'Structural DKT compatibility rules',
		output: (astGrep.stdout || astGrep.stderr).trim(),
	})
} else if (astGrep.status !== 0) {
	console.error(`[guardrails] ast-grep exited with status ${astGrep.status}`)
	console.error(astGrep.stderr)
	process.exit(2)
}

if (violations.length > 0) {
  console.error('\nDKT hard rewrite guardrails failed. Violations found:\n')
  for (const violation of violations) {
    console.error(`- ${violation.check}`)
    console.error(violation.output)
    console.error('')
  }
  process.exit(1)
}

console.log('DKT hard rewrite guardrails passed.')
