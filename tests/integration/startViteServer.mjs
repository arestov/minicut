import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

const SHARED_CACHE_ENV = 'MINICUT_VITE_CACHE'
const SHARED_CACHE_DIR_ENV = 'MINICUT_VITE_CACHE_DIR'

const makeIsolatedCacheDir = () =>
	path.join(os.tmpdir(), 'minicut-vite-cache', `${process.pid}-${randomUUID()}`)

const makeSharedCacheDir = (repoRoot) =>
	process.env[SHARED_CACHE_DIR_ENV] || path.join(repoRoot, '.tmp', 'vite-test-cache')

const resolveCacheDir = ({ repoRoot }) => {
	if (process.env[SHARED_CACHE_ENV] === 'shared') {
		return {
			cacheDir: makeSharedCacheDir(repoRoot),
			isShared: true,
		}
	}

	return {
		cacheDir: makeIsolatedCacheDir(),
		isShared: false,
	}
}

const startViteServer = async ({ repoRoot, host, port }) => {
	const { cacheDir, isShared } = resolveCacheDir({ repoRoot })
	await mkdir(cacheDir, { recursive: true })

	const server = await createServer({
		configFile: path.join(repoRoot, 'vite.video-editor.config.js'),
		cacheDir,
		server: {
			host,
			port,
			strictPort: true,
		},
	})

	await server.listen()

	let closed = false
	const close = async () => {
		if (closed) {
			return
		}
		closed = true

		try {
			await server.close()
		} finally {
			if (!isShared) {
				await rm(cacheDir, { recursive: true, force: true })
			}
		}
	}

	return {
		close,
	}
}

export default startViteServer
