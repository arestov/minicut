// @ts-expect-error plain ESM script without type declarations
import { buildElectron } from '../../../scripts/build-electron.mjs'
import { cleanupBundledBodies } from './runInElectron'

/** Builds main, preload and renderer once; window tests load the build. */
export default async function setup() {
	await buildElectron()
	return () => {
		cleanupBundledBodies()
	}
}
