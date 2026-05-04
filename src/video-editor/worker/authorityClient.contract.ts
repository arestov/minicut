import { getResourceEntities } from '../domain/selectors'
import { CMD, type PatchEnvelope } from '../domain/types'
import type { EditorAuthorityClient } from './authorityClient'

interface AuthorityClientContractCase {
	label: string
	createClient: () => EditorAuthorityClient
}

const asPromise = <T>(value: T | Promise<T>): Promise<T> => Promise.resolve(value)

export const runAuthorityClientContract = ({
	label,
	createClient,
}: AuthorityClientContractCase): void => {
	describe(`${label} authority contract`, () => {
		it('starts with empty snapshot and no history', async () => {
			const client = createClient()
			try {
				const snapshot = await asPromise(client.getSnapshot())
				expect(Object.keys(snapshot.projects)).toHaveLength(0)
				expect(snapshot.activeProjectId).toBeNull()
				expect(await asPromise(client.getHistoryState())).toEqual({
					canUndo: false,
					canRedo: false,
				})
			} finally {
				client.destroy?.()
			}
		})

		it('dispatches commands and updates snapshots deterministically', async () => {
			const client = createClient()
			try {
				const projectResult = await asPromise(client.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'Contract project' } }))
				const projectId = String(projectResult.createdIds?.projectId)
				expect(projectId.length).toBeGreaterThan(0)
				const importResult = await asPromise(client.dispatch({
					c: CMD.RESOURCE_IMPORT,
					p: {
						projectId,
						name: 'Contract source',
						kind: 'video',
						duration: 3,
					},
				}))
				expect(importResult.createdIds?.resourceId).toBeDefined()

				const snapshot = await asPromise(client.getSnapshot())
				const project = snapshot.projects[projectId]
				expect(project).toBeDefined()
				expect(getResourceEntities(snapshot, project)).toHaveLength(1)
				expect(await asPromise(client.getHistoryState())).toEqual({
					canUndo: true,
					canRedo: false,
				})
			} finally {
				client.destroy?.()
			}
		})

		it('notifies patch subscribers and honors unsubscribe', async () => {
			const client = createClient()
			const listener = vi.fn<(envelope: PatchEnvelope) => void>()
			const unsubscribe = client.subscribe(listener)
			try {
				await asPromise(client.dispatch({ c: CMD.PROJECT_CREATE, p: {} }))
				expect(listener).toHaveBeenCalledTimes(1)

				unsubscribe()
				await asPromise(client.dispatch({ c: CMD.PROJECT_CREATE, p: {} }))
				expect(listener).toHaveBeenCalledTimes(1)
			} finally {
				client.destroy?.()
			}
		})

		it('supports undo/redo round-trip with history state updates', async () => {
			const client = createClient()
			try {
				const createResult = await asPromise(client.dispatch({ c: CMD.PROJECT_CREATE, p: {} }))
				const projectId = String(createResult.createdIds?.projectId)
				await asPromise(client.dispatch({
					c: CMD.RESOURCE_IMPORT,
					p: { projectId, name: 'Undo clip', kind: 'video', duration: 2 },
				}))

				const undoEnvelope = await asPromise(client.undo())
				expect(undoEnvelope).not.toBeNull()
				expect(await asPromise(client.getHistoryState())).toEqual({
					canUndo: true,
					canRedo: true,
				})

				const redoEnvelope = await asPromise(client.redo())
				expect(redoEnvelope).not.toBeNull()
				expect(await asPromise(client.getHistoryState())).toEqual({
					canUndo: true,
					canRedo: false,
				})
			} finally {
				client.destroy?.()
			}
		})

		it('replaces snapshots and notifies subscribers', async () => {
			const sourceClient = createClient()
			const targetClient = createClient()
			const listener = vi.fn<(envelope: PatchEnvelope) => void>()
			targetClient.subscribe(listener)
			try {
				expect(typeof targetClient.replaceSnapshot).toBe('function')
				const createResult = await asPromise(sourceClient.dispatch({ c: CMD.PROJECT_CREATE, p: { title: 'Restored project' } }))
				const sourceSnapshot = await asPromise(sourceClient.getSnapshot())

				await asPromise(targetClient.replaceSnapshot?.(sourceSnapshot))
				const restoredSnapshot = await asPromise(targetClient.getSnapshot())

				expect(Object.keys(restoredSnapshot.projects)).toEqual(Object.keys(sourceSnapshot.projects))
				expect(restoredSnapshot.projects[String(createResult.createdIds?.projectId)]).toBeDefined()
				expect(listener).toHaveBeenCalledWith(expect.objectContaining({ patches: expect.any(Array) }))
				expect(await asPromise(targetClient.getHistoryState())).toEqual({
					canUndo: false,
					canRedo: false,
				})
			} finally {
				sourceClient.destroy?.()
				targetClient.destroy?.()
			}
		})
	})
}
