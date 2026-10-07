import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

	it('routes export and playback to the window that started them', async () => {
		const result = await runInElectron<{
			connected: Connected[]
			exportDeliveries: { sessionId: string; type: string }[]
			playbackStarts: { sessionId: string; type: string }[]
		}>(body, { params: { scenario: 'twoWindowEffects' } })

		const [first, second] = result.connected
		expect(
			result.exportDeliveries.map(({ sessionId, type }) => ({ sessionId, type })),
		).toEqual([
			{ sessionId: first.sessionId, type: 'dkt:export-request' },
		])
		// A run started in the first window is applied there and nowhere else.
		expect(result.playbackStarts.length).toBeGreaterThan(0)
		expect(result.playbackStarts.every((delivery) => delivery.sessionId === first.sessionId)).toBe(true)
		expect(second.sessionId).not.toBe(first.sessionId)
	})
})
