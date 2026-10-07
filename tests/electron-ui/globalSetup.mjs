import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildElectron } from '../../scripts/build-electron.mjs'

const require = createRequire(import.meta.url)

export const FIXTURE_DIR_ENV = 'MINICUT_ELECTRON_UI_FIXTURES'

// A real, decodable clip: 4 s test pattern with a tone, small enough to read
// in a few range requests. The checked-in 3 MB fixture is filler, not video.
const generateVideoFixture = (outputPath) => {
	const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
	const result = spawnSync(
		ffmpeg,
		[
			'-y', '-loglevel', 'error',
			'-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=4',
			'-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
			'-c:v', 'libvpx', '-b:v', '200k', '-g', '15',
			'-c:a', 'libvorbis', '-shortest', outputPath,
		],
		{ encoding: 'utf8' },
	)
	if (result.status !== 0) {
		throw new Error(`ffmpeg failed to generate the video fixture: ${result.stderr}`)
	}
}

export default async function setup() {
	await buildElectron()
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minicut-electron-ui-fixtures-'))
	generateVideoFixture(path.join(dir, 'clip-4s.webm'))
	process.env[FIXTURE_DIR_ENV] = dir
	return () => {
		fs.rmSync(dir, { recursive: true, force: true })
	}
}
