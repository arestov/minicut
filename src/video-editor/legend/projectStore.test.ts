import { describe, expect, it } from 'vitest'
import { buildDispatchResult } from '../domain/applyCommand'
import { createEmptyRegistry } from '../domain/createProject'
import { CMD, PATCH, type PatchEnvelope } from '../domain/types'
import { applyPatchEnvelope, createProjectsStore } from './projectStore'

describe('projectStore patch adapter', () => {
	it('applies table-driven patch handlers and updates project version', () => {
		const initial = createEmptyRegistry()
		const createProject = buildDispatchResult(initial, { c: CMD.PROJECT_CREATE, p: { title: 'Legend parity' } })
		const projects$ = createProjectsStore()

		applyPatchEnvelope(projects$, createProject.envelope)

		const createdProjectId = String(createProject.createdIds?.projectId)
		expect(projects$.projects[createdProjectId].id.get()).toBe(createdProjectId)
		expect(projects$.projects[createdProjectId].version.get()).toBe(createProject.envelope.version)
	})

	it('stops processing remaining patches after registry replacement', () => {
		const projects$ = createProjectsStore()
		const envelope: PatchEnvelope = {
			projectId: 'project:registry',
			version: 42,
			patches: [
				{
					c: PATCH.REGISTRY_SET,
					p: {
						registry: {
							activeProjectId: 'project:from-registry',
							projects: {
								'project:registry': {
									id: 'project:registry',
									rootEntityId: 'timeline:1',
									version: 7,
								},
							},
							entitiesById: {
								'timeline:1': {
									id: 'timeline:1',
									type: 'timeline',
									attrs: {},
									rels: { tracks: [] },
								},
							},
						},
					},
				},
				{
					c: PATCH.WORKSPACE_ACTIVE_PROJECT_SET,
					p: { projectId: 'project:should-not-apply' },
				},
			],
		}

		applyPatchEnvelope(projects$, envelope)

		expect(projects$.activeProjectId.get()).toBe('project:from-registry')
		expect(projects$.projects['project:registry'].version.get()).toBe(7)
	})
})
