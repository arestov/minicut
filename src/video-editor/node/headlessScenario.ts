import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Command } from '../domain/types'
import { createVideoEditorHarness } from '../app/createVideoEditorHarness'
import { createNodeHarnessPlatform } from '../app/platform/nodePlatform'

export interface HeadlessOperationProjectCreate {
op: 'project:create'
title?: string
}

export interface HeadlessOperationResourceImport {
op: 'resource:import'
projectId?: string
projectRef?: 'lastProject'
name: string
kind: 'video' | 'audio' | 'image'
duration: number
mime?: string
url?: string
size?: number
}

export interface HeadlessOperationTimelineAddClip {
op: 'timeline:add-clip'
projectId?: string
projectRef?: 'lastProject'
resourceId?: string
resourceRef?: 'lastResource'
includeLinkedAudio?: boolean
}

export type HeadlessOperation =
| HeadlessOperationProjectCreate
| HeadlessOperationResourceImport
| HeadlessOperationTimelineAddClip

export interface HeadlessScenario {
commands?: Command[]
operations?: HeadlessOperation[]
export?:
| { type: 'project' }
| { type: 'clip'; clipId?: string }
}

export interface HeadlessScenarioResult {
projectCount: number
activeProjectId: string | null
resourceCount: number
exported?: {
fileName: string
mimeType: string
size: number
frameCount: number
duration: number
range: { type: 'project' } | { type: 'clip'; clipId: string }
}
}

/**
 * TODO Phase 5: Rewrite headlessScenario to use DKT actions + pageRuntime tree traversal.
 * Registry-based dispatch (harness.worker.dispatch, harness.worker.getSnapshot) removed in Phase 1.
 */
export const runHeadlessScenario = async (_scenario: HeadlessScenario): Promise<HeadlessScenarioResult> => {
const _platform = createNodeHarnessPlatform()
const _harness = createVideoEditorHarness(undefined, { platform: _platform })
_harness.destroy()
throw new Error(
'headlessScenario: registry protocol removed in Phase 1. ' +
'Rewrite pending for Phase 5 using DKT actions (harness.actions.*) and pageRuntime tree traversal.'
)
}

export const runHeadlessScenarioFile = async (
scenarioPath: string,
outputPath?: string,
): Promise<HeadlessScenarioResult> => {
const absoluteScenarioPath = path.resolve(scenarioPath)
const scenario = JSON.parse(await readFile(absoluteScenarioPath, 'utf8')) as HeadlessScenario
const result = await runHeadlessScenario(scenario)

if (outputPath) {
const absoluteOutputPath = path.resolve(outputPath)
await writeFile(absoluteOutputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

return result
}
