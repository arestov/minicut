import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureFixtures } from '../../src/video-editor/media/node/testing/mediaFixtures'
import { removeDirRetrying, runInElectron } from './_harness/runInElectron'

const body = path.resolve(__dirname, 'desktop.body.ts')

type Connected = { sessionId: string; webContentsId: number }

describe('desktop host in real Electron windows', () => {
	const profiles: string[] = []
	const newProfile = () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minicut-electron-profile-'))
		profiles.push(dir)
		return dir
	}
	afterEach(() => {
		for (const dir of profiles.splice(0)) removeDirRetrying(dir)
	})

	it('restores an edit after the app is closed and opened again, with the same identity', async () => {
		const userDataDir = newProfile()

		const first = await runInElectron<{
			clicked: boolean
			peerId: string
			roomId: string
			localIdentity: string
		}>(body, { userDataDir, params: { scenario: 'editAndQuit' } })
		const second = await runInElectron<{
			text: string
			peerId: string
			roomId: string
			localIdentity: string
		}>(body, { userDataDir, params: { scenario: 'restore' } })

		expect(first.clicked).toBe(true)
		expect(second.text).toMatch(/3 tracks/)
		expect(second.roomId).toBe(first.roomId)
		expect(second.localIdentity).toBe(first.localIdentity)
		expect(second.peerId).toBe(first.peerId)
	})

	it('gives a new profile a different room and replica identity', async () => {
		const a = await runInElectron<{ roomId: string; localIdentity: string }>(body, {
			userDataDir: newProfile(),
			params: { scenario: 'editAndQuit' },
		})
		const b = await runInElectron<{ roomId: string; localIdentity: string }>(body, {
			userDataDir: newProfile(),
			params: { scenario: 'editAndQuit' },
		})

		expect(b.roomId).not.toBe(a.roomId)
		expect(b.localIdentity).not.toBe(a.localIdentity)
	})

	it('lets two windows share one room with separate sessions and shared changes', async () => {
		const result = await runInElectron<{
			connected: Connected[]
			roomId: string
			secondSawEdit: boolean
		}>(body, { params: { scenario: 'twoWindows' } })

		expect(result.connected).toHaveLength(2)
		const [first, second] = result.connected
		expect(first.sessionId).not.toBe(second.sessionId)
		expect(first.sessionId.startsWith(`${result.roomId}:window:`)).toBe(true)
		expect(second.sessionId.startsWith(`${result.roomId}:window:`)).toBe(true)
		expect(result.secondSawEdit).toBe(true)
	})

	it('keeps the window mapping on reload and detaches on close', async () => {
		const result = await runInElectron<{
			before: Connected[]
			after: Connected[]
			afterClose: Connected[]
			connectionCounts: number[]
		}>(body, { params: { scenario: 'reload' } })

		expect(result.before).toHaveLength(1)
		expect(result.after).toEqual(result.before)
		expect(result.afterClose).toEqual([])
		// The old connection is detached before the new document connects: never two.
		expect(result.connectionCounts).toEqual([0, 1, 0])
	})

	it('runs export in main and routes playback to the window that started it', async () => {
		const result = await runInElectron<{
			connected: Connected[]
			exportDeliveries: { sessionId: string; type: string }[]
			exportStatus: string | null
			playbackStarts: { sessionId: string; type: string }[]
		}>(body, { params: { scenario: 'twoWindowEffects' } })

		const [first, second] = result.connected
		// Export, import and recovery requests never reach a renderer ...
		expect(result.exportDeliveries).toEqual([])
		// ... the window that asked still sees the outcome from the media service.
		expect(result.exportStatus).toMatch(/Export (ready|failed)/)
		// A run started in the first window is applied there and nowhere else.
		expect(result.playbackStarts.length).toBeGreaterThan(0)
		expect(result.playbackStarts.every((delivery) => delivery.sessionId === first.sessionId)).toBe(true)
		expect(second.sessionId).not.toBe(first.sessionId)
	})

	it('imports a picked file as a local asset, exports it in the media service and restores it after a restart', async () => {
		const fixtures = await ensureFixtures(['video-cfr'])
		const media = fixtures['video-cfr']
		const userDataDir = newProfile()

		const first = await runInElectron<{
			assetUrl: string | null
			range: { status: number; bytes: number; contentRange: string | null } | null
			assets: string[]
			exportStatus: string | null
			exportedFiles: string[]
			exportDirectory: string
			leaked: { type: string }[]
			dropped: { type: string; reason: string }[]
		}>(body, { userDataDir, params: { scenario: 'importAndExport', media } })

		// The renderer plays the media by asset id; the path never reaches it.
		expect(first.assetUrl).toMatch(/^[/]asset[/]/)
		expect(first.range).toMatchObject({ status: 206, bytes: 10 })
		expect(first.assets.map((p) => p.toLowerCase())).toEqual([media.toLowerCase()])
		// Export ran in the media service: a real file in the export directory.
		expect(first.exportStatus).toMatch(/Export ready/)
		expect(first.exportedFiles.filter((name) => name.endsWith('.webm'))).toHaveLength(1)
		expect(first.leaked).toEqual([])
		expect(first.dropped.filter((effect) => effect.type !== 'dkt:playback-run-request')).toEqual([])

		const second = await runInElectron<{
			assetUrl: string | null
			range: { status: number; bytes: number } | null
			assets: string[]
			leaked: { type: string }[]
			mentionsMissing: boolean
		}>(body, { userDataDir, params: { scenario: 'restoreMedia', media } })

		expect(second.assetUrl).toBe(first.assetUrl)
		expect(second.range).toMatchObject({ status: 206, bytes: 10 })
		expect(second.assets.map((p) => p.toLowerCase())).toEqual([media.toLowerCase()])
		expect(second.mentionsMissing).toBe(false)
		// Boot restore runs in main as well: no recovery request reaches a window.
		expect(second.leaked).toEqual([])
	})

	it('fails a second app on the profile of a running one with the typed database error', async () => {
		const result = await runInElectron<{ failure: { name: string; message: string } | null }>(body, {
			userDataDir: newProfile(),
			params: { scenario: 'profileLocked' },
		})

		expect(result.failure?.name).toBe('NodeLevelDbStorageOpenError')
		expect(result.failure?.message).toMatch(/Failed to open MiniCut LevelDB storage/)
	})
})
