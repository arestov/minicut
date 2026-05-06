import { runHeadlessScenario } from './headlessScenario'

// Behavior contract: node headless scenarios must be rebuilt on DKT actions/pageRuntime traversal.
describe.skip('headless node scenario runtime', () => {
it('runs operation scenarios and reports summary', async () => {
const result = await runHeadlessScenario({
operations: [
{ op: 'project:create', title: 'Node project' },
{ op: 'resource:import', projectRef: 'lastProject', name: 'Clip A', kind: 'video', duration: 2 },
],
})

expect(result.projectCount).toBe(1)
expect(result.activeProjectId).toBeTruthy()
expect(result.resourceCount).toBe(1)
})

it('supports manifest project export in node runtime', async () => {
const result = await runHeadlessScenario({
operations: [
{ op: 'project:create', title: 'Node export' },
{ op: 'resource:import', projectRef: 'lastProject', name: 'Clip A', kind: 'video', duration: 2 },
{ op: 'timeline:add-clip', projectRef: 'lastProject', resourceRef: 'lastResource' },
],
export: { type: 'project' },
})

expect(result.exported).toBeDefined()
expect(result.exported?.mimeType).toBe('application/vnd.minicut.export+json')
expect(result.exported?.range).toEqual({ type: 'project' })
expect(result.exported?.frameCount).toBeGreaterThan(0)
})
})
