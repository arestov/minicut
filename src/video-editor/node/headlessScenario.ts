import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getActiveProject, getResourceEntities } from '../domain/selectors'
import { CMD, type Command, type DispatchResult, type ProjectRegistry } from '../domain/types'
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

interface OperationContext {
lastProjectId: string | null
lastResourceId: string | null
lastClipId: string | null
}

const asPromise = <T>(value: Promise<T> | T): Promise<T> => Promise.resolve(value)

const resolveProjectId = (operation: { projectId?: string; projectRef?: 'lastProject' }, context: OperationContext): string => {
if (operation.projectRef === 'lastProject') {
if (!context.lastProjectId) {
throw new Error('projectRef=lastProject requested before a project was created')
}
return context.lastProjectId
}
if (operation.projectId) {
return operation.projectId
}
if (!context.lastProjectId) {
throw new Error('Project id is required when no last project exists')
}
return context.lastProjectId
}

const resolveResourceId = (operation: { resourceId?: string; resourceRef?: 'lastResource' }, context: OperationContext): string => {
if (operation.resourceRef === 'lastResource') {
if (!context.lastResourceId) {
throw new Error('resourceRef=lastResource requested before a resource was imported')
}
return context.lastResourceId
}
if (operation.resourceId) {
return operation.resourceId
}
if (!context.lastResourceId) {
throw new Error('Resource id is required when no last resource exists')
}
return context.lastResourceId
}

const applyCreatedIds = (result: DispatchResult, context: OperationContext): void => {
if (result.createdIds?.projectId) {
context.lastProjectId = String(result.createdIds.projectId)
}
if (result.createdIds?.resourceId) {
context.lastResourceId = String(result.createdIds.resourceId)
}
if (result.createdIds?.clipId) {
context.lastClipId = String(result.createdIds.clipId)
}
}

const toCommand = (operation: HeadlessOperation, context: OperationContext): Command => {
switch (operation.op) {
case 'project:create':
return { c: CMD.PROJECT_CREATE, p: { title: operation.title } }
case 'resource:import':
return {
c: CMD.RESOURCE_IMPORT,
p: {
projectId: resolveProjectId(operation, context),
name: operation.name,
kind: operation.kind,
duration: operation.duration,
mime: operation.mime,
url: operation.url,
size: operation.size,
},
}
case 'timeline:add-clip':
return {
c: CMD.TIMELINE_ADD_CLIP,
p: {
projectId: resolveProjectId(operation, context),
resourceId: resolveResourceId(operation, context),
includeLinkedAudio: operation.includeLinkedAudio,
},
}
}
}

const resolveClipForExport = (registry: ProjectRegistry, explicitClipId?: string): string => {
if (explicitClipId) {
return explicitClipId
}

const firstClip = Object.values(registry.entitiesById).find((entity) => entity?.type === 'clip')
if (!firstClip) {
throw new Error('No clip found for clip export range')
}

return firstClip.id
}

export const runHeadlessScenario = async (scenario: HeadlessScenario): Promise<HeadlessScenarioResult> => {
const platform = createNodeHarnessPlatform()
const harness = createVideoEditorHarness(undefined, {
autoCreateInitialProject: false,
platform,
})
const context: OperationContext = {
lastProjectId: null,
lastResourceId: null,
lastClipId: null,
}

try {
for (const command of scenario.commands ?? []) {
const dispatchResult = await asPromise(harness.worker.dispatch(command))
applyCreatedIds(dispatchResult, context)
}

for (const operation of scenario.operations ?? []) {
const dispatchResult = await asPromise(harness.worker.dispatch(toCommand(operation, context)))
applyCreatedIds(dispatchResult, context)
}

const registry = await asPromise(harness.worker.getSnapshot())
const activeProjectId = registry.activeProjectId ?? Object.keys(registry.projects)[0] ?? null
const activeProject = activeProjectId
? getActiveProject(registry, { activeProjectId })
: null
const result: HeadlessScenarioResult = {
projectCount: Object.keys(registry.projects).length,
activeProjectId,
resourceCount: activeProject ? getResourceEntities(registry, activeProject).length : 0,
}

if (!scenario.export || !activeProjectId) {
return result
}

const renderer = platform.createExportRenderer()
if (scenario.export.type === 'project') {
const exportResult = await renderer.render({
registry,
projectId: activeProjectId,
range: { type: 'project' },
format: 'json-manifest',
})
result.exported = {
fileName: exportResult.fileName,
mimeType: exportResult.mimeType,
size: exportResult.size,
frameCount: exportResult.frameCount,
duration: exportResult.duration,
range: { type: 'project' },
}
return result
}

const clipId = resolveClipForExport(registry, scenario.export.clipId ?? context.lastClipId ?? undefined)
const exportResult = await renderer.render({
registry,
projectId: activeProjectId,
range: { type: 'clip', clipId },
format: 'json-manifest',
})
result.exported = {
fileName: exportResult.fileName,
mimeType: exportResult.mimeType,
size: exportResult.size,
frameCount: exportResult.frameCount,
duration: exportResult.duration,
range: { type: 'clip', clipId },
}
return result
} finally {
harness.destroy()
}
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
