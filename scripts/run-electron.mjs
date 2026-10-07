// Builds the Electron host and starts it. Extra args go to the app.
//   npm run electron:dev                      built renderer
//   MINICUT_RENDERER_URL=http://localhost:4175 npm run electron:dev   Vite dev server
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { buildElectron } from './build-electron.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await buildElectron({ renderer: !process.env.MINICUT_RENDERER_URL })
const child = spawn(
	electronPath,
	[path.join(repoRoot, 'dist-electron/main/main.mjs'), ...process.argv.slice(2)],
	{ stdio: 'inherit' },
)
child.on('exit', (code) => process.exit(code ?? 0))
