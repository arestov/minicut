import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const viewerRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(viewerRoot, '../..')
const snapshotRoot = path.join(repoRoot, 'app-structure.snapshot')

const SNAPSHOT_FILES = new Set(['core.json', 'derived.json'])

function snapshotRoute() {
  return {
    name: 'linkkraft-structure-snapshot-route',
    configureServer(server) {
      server.middlewares.use('/snapshot', async (req, res, next) => {
        try {
          const url = new URL(req.url || '/', 'http://structure-viewer.local')
          const fileName = url.pathname.replace(/^\/+/, '') || 'core.json'

          if (!SNAPSHOT_FILES.has(fileName)) {
            next()
            return
          }

          const filePath = path.join(snapshotRoot, fileName)
          const content = await readFile(filePath, 'utf8')
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(content)
        } catch (error) {
          res.statusCode = error?.code === 'ENOENT' ? 404 : 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              error: error?.message || String(error),
            }),
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [svelte(), snapshotRoute()],
  server: {
    fs: {
      allow: [viewerRoot, repoRoot],
    },
  },
})
