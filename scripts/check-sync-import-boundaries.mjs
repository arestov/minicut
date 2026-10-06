import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Import boundaries between the UI sync layers:
// - dkt-ui-sync is framework-agnostic;
// - dkt-solid-sync must not know React or dkt-react-sync;
// - React code (dkt-react-sync, video-editor) must not know Solid or GPUIX.
const reactForbidden = [/^react($|\/)/, /^react-dom($|\/)/, /dkt-react-sync/]
const solidForbidden = [/^solid-js($|\/)/, /^@gpuix\//, /dkt-solid-sync/]

const rules = [
	{ root: 'src/dkt-ui-sync', forbidden: [...reactForbidden, ...solidForbidden] },
	{ root: 'src/dkt-solid-sync', forbidden: reactForbidden },
	{ root: 'src/dkt-react-sync', forbidden: solidForbidden },
	{ root: 'src/video-editor', forbidden: solidForbidden },
]

const sourceFile = /\.(?:[cm]?[jt]sx?)$/
const specifierPattern =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g

const walk = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (name === 'node_modules') return []
		return statSync(path).isDirectory() ? walk(path) : [path]
	})

const violations = []

for (const { root, forbidden } of rules) {
	let files
	try {
		files = walk(root).filter((file) => sourceFile.test(file))
	} catch {
		continue
	}

	for (const file of files) {
		const text = readFileSync(file, 'utf8')
		for (const match of text.matchAll(specifierPattern)) {
			const specifier = match[2]
			if (forbidden.some((pattern) => pattern.test(specifier))) {
				const line = text.slice(0, match.index).split('\n').length
				violations.push(`${file.split(String.fromCharCode(92)).join('/')}:${line} imports "${specifier}"`)
			}
		}
	}
}

if (violations.length > 0) {
	console.error('Sync import boundary violations:')
	for (const violation of violations) console.error(`  ${violation}`)
	process.exit(1)
}

console.log('sync import boundaries ok')
