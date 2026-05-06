// @ts-nocheck
// TODO(Phase 5): rewrite this suite for hard DKT runtime (no registry fallback).
import { getActiveProject, getClipIdsForTrack, getResourceEntities, getVideoTrack } from '../domain/selectors'
import { CMD } from '../domain/types'
import { createFallbackAuthorityClient } from './fallbackAuthorityClient'
import { MemoryWorkerAuthority } from './memoryWorker'
import type { EditorAuthorityClient } from './authorityClient'

const runScenario = async (client: EditorAuthorityClient) => {
try {
const first = await Promise.resolve(client.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'Parity run' } }))
const projectId = String(first.createdIds?.projectId)
await Promise.resolve(client.dispatch({
c: CMD.RESOURCE_IMPORT,
p: { projectId, name: 'A.mov', kind: 'video', duration: 3 },
}))
const second = await Promise.resolve(client.dispatch({
c: CMD.RESOURCE_IMPORT,
p: { projectId, name: 'B.mov', kind: 'video', duration: 2 },
}))
await Promise.resolve(client.dispatch({
c: CMD.TIMELINE_ADD_CLIP,
p: {
projectId,
resourceId: String(second.createdIds?.resourceId),
},
}))

const snapshot = await Promise.resolve(client.getSnapshot())
const activeProject = getActiveProject(snapshot, { activeProjectId: snapshot.activeProjectId })
const resourceCount = activeProject ? getResourceEntities(snapshot, activeProject).length : 0
const videoTrack = activeProject ? getVideoTrack(snapshot, activeProject) : null
const clipCount = videoTrack ? getClipIdsForTrack(snapshot, videoTrack.id).length : 0

return {
projectCount: Object.keys(snapshot.projects).length,
resourceCount,
clipCount,
}
} finally {
client.destroy?.()
}
}

// Behavior contract: fallback and in-memory authorities must align on DKT transport semantics.
// Skipped: parity suite still validates removed registry command/snapshot protocol.
describe.skip('authority runtime parity', () => {
it('keeps command outcomes aligned between memory and fallback runtimes', async () => {
const [memoryResult, fallbackResult] = await Promise.all([
runScenario(new MemoryWorkerAuthority()),
runScenario(createFallbackAuthorityClient()),
])

expect(memoryResult).toEqual(fallbackResult)
})
})
