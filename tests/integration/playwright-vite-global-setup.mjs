import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

export default async function setupViteServer() {
	const server = await createServer({
		configFile: path.join(repoRoot, 'vite.video-editor.config.js'),
		server: {
			host: '127.0.0.1',
			port: 4174,
			strictPort: true,
		},
	})

	await server.listen()

	return async () => {
		await server.close()
	}
}
