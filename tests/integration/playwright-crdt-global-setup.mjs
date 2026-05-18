import path from 'node:path'
import { fileURLToPath } from 'node:url'
import startViteServer from './startViteServer.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

export default async function setupCrdtViteServer() {
	process.env.VITE_MINICUT_ENABLE_CRDT_TEST_HARNESS = '1'
	const frontend = await startViteServer({
		repoRoot,
		host: '127.0.0.1',
		port: 4176,
	})

	return async () => {
		await frontend.close()
	}
}
