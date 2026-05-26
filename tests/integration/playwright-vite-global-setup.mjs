import path from 'node:path'
import { fileURLToPath } from 'node:url'
import startViteServer from './startViteServer.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

export default async function setupViteServer() {
	const frontend = await startViteServer({
		repoRoot,
		host: '127.0.0.1',
		port: 4174,
	})

	return async () => {
		await frontend.close()
	}
}
