import { describe, expect, it } from 'vitest'
import { createEmptyRegistry, createProjectGraph } from '../../domain/createProject'
import { createMiniCutDktPageSyncReceiver } from './pageSyncReceiver'
import { DKT_MSG } from '../shared/messageTypes'

describe('createMiniCutDktPageSyncReceiver', () => {
	it('accepts registry snapshots from the DKT transport boundary', () => {
		const receiver = createMiniCutDktPageSyncReceiver()
		const graph = createProjectGraph('Sync test', 1)
		const snapshot = createEmptyRegistry()
		snapshot.activeProjectId = graph.project.id
		snapshot.projects[graph.project.id] = graph.project
		for (const entity of graph.entities) {
			snapshot.entitiesById[entity.id] = entity
		}
		let notifications = 0
		const unsubscribe = receiver.subscribe(() => {
			notifications += 1
		})

		receiver.handleMessage({ type: DKT_MSG.SNAPSHOT, snapshot })

		expect(receiver.getSnapshot()).toEqual(snapshot)
		expect(notifications).toBe(1)
		unsubscribe()
	})
})
