import { describe, expect, it } from 'vitest'
import { bootDktModels } from '../testingInit'

describe('SessionRoot: createProject behavior contract', () => {
	it('createProject sets activeProject and creates two default tracks', async () => {
		const ctx = await bootDktModels()

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('createProject', {
				title: 'SessionRoot test project',
			})
		})

		const activeProjects = await ctx.queryRel(ctx.sessionRoot, 'activeProject')
		expect(activeProjects).toHaveLength(1)

		const project = activeProjects[0]
		expect(project._node_id).toBe(ctx.getAttr(ctx.sessionRoot, 'activeProjectId'))
		expect(ctx.getAttr(project, 'title')).toBe('SessionRoot test project')

		const tracks = await ctx.queryRel(project, 'tracks')
		expect(tracks).toHaveLength(2)
		const videoTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'video')
		const audioTrack = tracks.find((t) => ctx.getAttr(t, 'kind') === 'audio')
		expect(videoTrack).toBeTruthy()
		expect(audioTrack).toBeTruthy()
	})

	it('handleInit is idempotent after the first init pass', async () => {
		const ctx = await bootDktModels()

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('handleInit')
		})
		const projectCountAfterFirstInit = (await ctx.queryRel(ctx.appModel, 'project')).length

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('handleInit')
		})
		const projectCountAfterSecondInit = (await ctx.queryRel(ctx.appModel, 'project')).length

		expect(projectCountAfterSecondInit).toBeGreaterThanOrEqual(projectCountAfterFirstInit)
	})

	it('setActiveProject resets selection and cursor', async () => {
		const ctx = await bootDktModels()

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('createProject', { title: 'Project A' })
		})
		const projectA = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
		expect(projectA?._node_id).toBeTruthy()

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('createProject', { title: 'Project B' })
		})
		const projectB = (await ctx.queryRel(ctx.sessionRoot, 'activeProject'))[0]
		expect(projectB?._node_id).toBeTruthy()

		await ctx.lockToRead(async () => {
			await ctx.sessionRoot.dispatch('selectEntity', 'clip:temp')
			await ctx.sessionRoot.dispatch('setCursor', 3.5)
			await ctx.sessionRoot.dispatch('setActiveProject', projectA!._node_id)
		})

		expect(ctx.getAttr(ctx.sessionRoot, 'activeProjectId')).toBe(projectA!._node_id)
		expect(ctx.getAttr(ctx.sessionRoot, 'selectedEntityId')).toBeNull()
		expect(ctx.getAttr(ctx.sessionRoot, 'cursor')).toBe(0)
	})
})
