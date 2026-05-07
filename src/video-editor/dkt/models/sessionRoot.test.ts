import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'

describe('SessionRoot: createProject behavior contract', () => {
	it('session bootstrap seeds exactly one default project via handleInit', async () => {
		const ctx = await bootDktModels()
		const activeProjectId = ctx.getAttr(ctx.sessionRoot, 'activeProjectId')
		expect(typeof activeProjectId).toBe('string')

		const projects = await ctx.queryRel(ctx.sessionRoot, 'activeProject')
		expect(projects).toHaveLength(1)

		const project = projects[0]
		expect(ctx.getAttr(project, 'sourceProjectId')).toBe(activeProjectId)
		expect(ctx.getAttr(project, 'title')).toBeTruthy()

		const tracks = await ctx.queryRel(project, 'tracks')
		expect(tracks).toHaveLength(2)
	})

	it('handleInit does not create a duplicate project when one already exists', async () => {
		const ctx = await bootDktModels()
		const initialProjects = await ctx.queryRel(ctx.appModel, 'project')
		expect(initialProjects).toHaveLength(1)
		const initialProjectId = ctx.getAttr(initialProjects[0], 'sourceProjectId')

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('handleInit')
		})

		const activeProjects = await ctx.queryRel(ctx.sessionRoot, 'activeProject')
		expect(activeProjects).toHaveLength(1)
		expect(ctx.getAttr(activeProjects[0], 'sourceProjectId')).toBe(initialProjectId)

		const projects = await ctx.queryRel(ctx.appModel, 'project')
		expect(projects).toHaveLength(1)
	})

	it('createProject → activeProject rel set → two default tracks created', async () => {
		const ctx = await bootDktModels()
		const projectId = 'project:session-root-test'

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('createProject', {
				sourceProjectId: projectId,
				title: 'SessionRoot test project',
			})
		})

		// activeProject rel is set on session root
		const activeProjects = await ctx.queryRel(ctx.sessionRoot, 'activeProject')
		expect(activeProjects).toHaveLength(1)

		const project = activeProjects[0]
		expect(ctx.getAttr(project, 'sourceProjectId')).toBe(projectId)

		// handleInit created exactly two tracks
		const tracks = await ctx.queryRel(project, 'tracks')
		expect(tracks).toHaveLength(2)

		const videoTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'video')
		const audioTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'audio')
		expect(videoTrack).toBeTruthy()
		expect(audioTrack).toBeTruthy()
		expect(ctx.getAttr(videoTrack!, 'name')).toBe('V1')
		expect(ctx.getAttr(audioTrack!, 'name')).toBe('A1')
	})
})
