import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeDirRetrying, runInElectron } from './_harness/runInElectron'

const body = path.resolve(__dirname, 'harness.sanity.body.ts')

describe('runInElectron harness', () => {
	it('runs a TypeScript body in the Electron main process and returns its result', async () => {
		const result = await runInElectron<{
			isReady: boolean
			electronVersion: string
			userDataIsIsolated: boolean
			windowCount: number
		}>(body)

		expect(result.isReady).toBe(true)
		expect(result.electronVersion).toBe('44.5.1')
		expect(result.userDataIsIsolated).toBe(true)
		expect(result.windowCount).toBe(0)
	})

	it('keeps a caller-owned profile directory between runs', async () => {
		const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minicut-electron-owned-'))
		try {
			await runInElectron(body, { userDataDir })

			expect(fs.readFileSync(path.join(userDataDir, 'marker.txt'), 'utf8')).toBe(
				'written by the body',
			)
		} finally {
			removeDirRetrying(userDataDir)
		}
	})

	it('reports a failing body with its message', async () => {
		await expect(runInElectron(body, { params: { mode: 'throw' } })).rejects.toThrow(
			'body failed on purpose',
		)
	})

	it('kills the process and fails when the body does not finish in time', async () => {
		await expect(
			runInElectron(body, { params: { mode: 'hang' }, timeoutMs: 15_000 }),
		).rejects.toThrow('timed out')
	}, 40_000)
})
