import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ensureFixtures } from '../../src/video-editor/media/node/testing/mediaFixtures'
import { removeDirRetrying, runInElectron } from './_harness/runInElectron'

const body = path.resolve(__dirname, 'media.body.ts')

/** Command lines of running ffmpeg processes. */
const ffmpegCommandLines = (): string[] => {
	try {
		const output =
			process.platform === 'win32'
				? execFileSync(
						'powershell.exe',
						[
							'-NoProfile',
							'-Command',
							"Get-CimInstance Win32_Process -Filter \"Name = 'ffmpeg.exe'\" | ForEach-Object { $_.CommandLine }",
						],
						{ encoding: 'utf8' },
					)
				: execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
		return output.split(/\r?\n/).filter((line) => /ffmpeg/i.test(line))
	} catch {
		return []
	}
}

describe('media service in a real Electron utility process', () => {
	const dirs: string[] = []
	let fixtures: Record<string, string>
	beforeAll(async () => {
		fixtures = await ensureFixtures(['video-cfr', 'audio-tone'])
	})
	afterEach(() => {
		for (const dir of dirs.splice(0)) removeDirRetrying(dir)
	})
	const params = (scenario: string) => {
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minicut-electron-media-'))
		dirs.push(outDir)
		return {
			scenario,
			fixtures,
			outDir,
			assetId: 'asset-cfr',
			assetPath: fixtures['video-cfr'],
		}
	}

	it('probes through the main-process registry and exports with progress', async () => {
		const p = params('probeAndExport')
		const result = await runInElectron<{
			width: number
			fingerprintVersion: string
			stages: string[]
			outcome: { status: string; artifact?: { frameCount: number } }
			exists: boolean
		}>(body, { params: p })

		expect(result.width).toBeGreaterThan(0)
		expect(result.fingerprintVersion).toMatch(/^sha256-chain-/)
		expect(result.stages).toContain('rendering')
		expect(result.outcome.status).toBe('done')
		expect(result.outcome.artifact?.frameCount).toBe(50)
		expect(result.exists).toBe(true)
	})

	it('cancel kills ffmpeg in the utility process and leaves no file', async () => {
		const p = params('cancelExport')
		const result = await runInElectron<{ outcome: { status: string }; left: string[] }>(body, {
			params: p,
		})

		expect(result.outcome.status).toBe('cancelled')
		expect(result.left).toEqual([])
		expect(ffmpegCommandLines().filter((line) => line.includes(p.outDir))).toEqual([])
	})

	it('fails the start with a typed error when ffmpeg is missing', async () => {
		const result = await runInElectron<{ started: boolean; code: string | null; message: string | null }>(
			body,
			{ params: params('missingFfmpeg') },
		)

		expect(result.started).toBe(false)
		expect(result.code).toBe('binary-not-found')
		expect(result.message).toMatch(/ffmpeg was not found/)
	})
})
