import { runHeadlessScenarioFile } from './headlessScenario'

const printUsage = (): void => {
	console.log('Usage: node --import tsx src/video-editor/node/cli.ts --scenario <path> [--out <path>]')
}

const parseArgs = (argv: string[]): { scenarioPath: string; outputPath?: string } => {
	let scenarioPath = ''
	let outputPath: string | undefined

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index]
		if (token === '--scenario') {
			scenarioPath = argv[index + 1] ?? ''
			index += 1
			continue
		}
		if (token === '--out') {
			outputPath = argv[index + 1]
			index += 1
		}
	}

	if (!scenarioPath) {
		throw new Error('Missing required --scenario argument')
	}

	return { scenarioPath, outputPath }
}

const main = async (): Promise<void> => {
	try {
		const { scenarioPath, outputPath } = parseArgs(process.argv.slice(2))
		const result = await runHeadlessScenarioFile(scenarioPath, outputPath)
		console.log(JSON.stringify(result, null, 2))
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		printUsage()
		console.error(`[minicut:headless] ${message}`)
		process.exitCode = 1
	}
}

void main()
