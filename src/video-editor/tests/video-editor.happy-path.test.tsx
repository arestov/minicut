import { act, fireEvent, screen, within } from '@testing-library/react'
import { getActiveProject, getResourceEntities } from '../domain/selectors'
import { renderVideoEditor } from './renderVideoEditor'

const createProjectFromMenu = async (user: ReturnType<typeof renderVideoEditor>['user']) => {
	const projectsRegion = screen.getByLabelText('Projects')
	await user.click(within(projectsRegion).getByRole('button'))
	await user.click(within(projectsRegion).getByRole('button', { name: 'New project' }))
}

const setTimelineCursor = (timeline: HTMLElement, seconds: number): void => {
	const laneScroll = timeline.querySelector('.ve-track-lane-scroll') as HTMLDivElement | null
	expect(laneScroll).not.toBeNull()

	const zoomText = within(timeline).getByText(/px\/s$/i).textContent ?? '56'
	const zoom = Number.parseFloat(zoomText)
	fireEvent.pointerDown(laneScroll as HTMLDivElement, {
		buttons: 1,
		clientX: seconds * zoom,
	})
}

const importSampleResource = async (harness: ReturnType<typeof renderVideoEditor>['harness']): Promise<void> => {
	await act(async () => {
		harness.actions.importSampleResource()
		await Promise.resolve()
		await Promise.resolve()
	})
}

describe('video editor harness', () => {
	it('runs the happy path: project -> import -> clip -> inspect -> split -> nudge', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			expect(screen.getByRole('button', { name: /Project \d+/i })).toBeInTheDocument()

			await importSampleResource(harness)
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			expect(clipButton).toBeInTheDocument()

			await user.click(clipButton)
			expect(screen.getByLabelText('Renderer stage')).toHaveTextContent('Sample asset 1')
			const inspector = screen.getByLabelText('Inspector')
			expect(within(inspector).getByText('Clip 1 - V1 - 0.0s')).toBeInTheDocument()
			expect(within(inspector).queryByText(/clip-18/i)).not.toBeInTheDocument()
			const opacitySlider = within(inspector).getByRole('slider', { name: 'Opacity' })
			expect(opacitySlider).toBeInTheDocument()
			fireEvent.change(opacitySlider, { target: { value: '60' } })

			expect(screen.getByText('60%', { selector: 'dd' })).toBeInTheDocument()
			await user.click(within(inspector).getByRole('button', { name: 'Blur' }))
			await user.click(within(inspector).getByRole('button', { name: 'Sharpen' }))
			expect(within(inspector).getByText('2 effects')).toBeInTheDocument()
			await user.click(within(inspector).getByRole('button', { name: 'Manage effects' }))
			await user.click(within(inspector).getByRole('button', { name: 'Remove effect Blur' }))
			expect(within(inspector).getByText('1 effects')).toBeInTheDocument()
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				filter: 'contrast(1.25) saturate(1.125)',
			})

			await user.click(within(inspector).getByRole('button', { name: 'Start +0.5s' }))
			expect(screen.getByText('0.5s', { selector: 'dd' })).toBeInTheDocument()

			const transformControls = within(inspector).getByLabelText('Transform controls')
			fireEvent.change(within(transformControls).getByLabelText('X'), { target: { value: '24' } })
			expect(within(transformControls).getByLabelText('X')).toHaveValue(24)

			const timeline = screen.getByLabelText('Timeline')
			setTimelineCursor(timeline, 2.75)

			await user.click(within(inspector).getByRole('button', { name: 'Split clip' }))
			expect(screen.getAllByRole('button', { name: /Sample asset 1/i })).toHaveLength(2)

			await user.click(within(inspector).getByRole('button', { name: 'Nudge +0.5s' }))
			expect(screen.getByText('3.3s')).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('splits clip at playhead and updates timeline clip widths from resulting durations', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)

			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			const timeline = screen.getByLabelText('Timeline')
			setTimelineCursor(timeline, 1.25)

			await user.click(within(screen.getByLabelText('Inspector')).getByRole('button', { name: 'Split clip' }))

			const splitClips = screen.getAllByRole('button', { name: /Sample asset 1/i }) as HTMLButtonElement[]
			expect(splitClips).toHaveLength(2)
			const leftWidth = Number.parseFloat(splitClips[0].style.width)
			const rightWidth = Number.parseFloat(splitClips[1].style.width)
			expect(leftWidth).toBeCloseTo(70, 0)
			expect(rightWidth).toBeCloseTo(210, 0)
		}
		finally {
			unmount()
		}
	})

	it('resizes a clip from its timeline edges', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)

			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			const endHandle = clipButton.querySelector('.ve-clip__resize-handle--end') as HTMLElement | null
			const startHandle = clipButton.querySelector('.ve-clip__resize-handle--start') as HTMLElement | null
			expect(endHandle).not.toBeNull()
			expect(startHandle).not.toBeNull()

			fireEvent.pointerDown(endHandle as HTMLElement, { clientX: 100, buttons: 1 })
			fireEvent.pointerUp(endHandle as HTMLElement, { clientX: 128, buttons: 0 })
			expect(clipButton).toHaveTextContent(/0\.0s \/ 5\.5s/)

			fireEvent.pointerDown(startHandle as HTMLElement, { clientX: 100, buttons: 1 })
			fireEvent.pointerUp(startHandle as HTMLElement, { clientX: 128, buttons: 0 })
			expect(clipButton).toHaveTextContent(/0\.5s \/ 5\.0s/)
		} finally {
			unmount()
		}
	})

	it('deletes selected clips through the inspector', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			await user.click(within(screen.getByLabelText('Inspector')).getByRole('button', { name: 'Delete clip' }))
			expect(screen.queryByRole('button', { name: /Sample asset 1 · 0.0s/i })).not.toBeInTheDocument()
			expect(screen.getByText('Select a clip to edit opacity or split it.')).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('applies clip color to timeline accent and renderer frame', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			const inspector = screen.getByLabelText('Inspector')
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			await user.click(within(inspector).getByRole('button', { name: 'Set color #16a34a' }))

			expect(clipButton).toHaveStyle({ borderLeftColor: 'rgb(22, 163, 74)' })
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				borderColor: 'rgb(22, 163, 74)',
			})
		}
		finally {
			unmount()
		}
	})

	it('interpolates keyframed opacity and transform values in the renderer', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipId = String(harness.session$.selectedEntityId.get())
			expect(clipId).not.toBe('null')

			act(() => {
				harness.projects$.entitiesById['keyframe:opacity-start'].set({ id: 'keyframe:opacity-start', type: 'keyframe', attrs: { time: 0, value: 1 }, rels: {} })
				harness.projects$.entitiesById['keyframe:opacity-end'].set({ id: 'keyframe:opacity-end', type: 'keyframe', attrs: { time: 5, value: 0 }, rels: {} })
				harness.projects$.entitiesById['keyframe:x-start'].set({ id: 'keyframe:x-start', type: 'keyframe', attrs: { time: 0, value: 0 }, rels: {} })
				harness.projects$.entitiesById['keyframe:x-end'].set({ id: 'keyframe:x-end', type: 'keyframe', attrs: { time: 5, value: 100 }, rels: {} })
				harness.projects$.entitiesById[clipId].attrs.opacity.set({ value: 1, keyframes: ['keyframe:opacity-start', 'keyframe:opacity-end'] })
				harness.projects$.entitiesById[clipId].attrs.transform.x.set({ value: 0, keyframes: ['keyframe:x-start', 'keyframe:x-end'] })
				harness.actions.setCursor(2.5)
			})

			const layer = screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')
			expect(layer).toHaveStyle({ opacity: '0.5' })
			expect(layer).toHaveStyle('transform: translate(50px, 0px) scale(1) rotate(0deg)')
		} finally {
			unmount()
		}
	})

	it('edits clip fade in and fade out controls and previews faded opacity', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			await user.click(screen.getByRole('button', { name: /Sample asset 1/i }))

			const inspector = screen.getByLabelText('Inspector')
			expect(within(inspector).getByRole('button', { name: 'Fade in -0.5s' })).toBeDisabled()
			expect(within(inspector).getByRole('button', { name: 'Fade out -0.5s' })).toBeDisabled()
			await user.click(within(inspector).getByRole('button', { name: 'Fade in +0.5s' }))
			await user.click(within(inspector).getByRole('button', { name: 'Fade out +0.5s' }))
			expect(within(inspector).getAllByText('0.5s', { selector: 'dd' })).toHaveLength(2)

			act(() => harness.actions.setCursor(0))
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({ opacity: '0' })
			act(() => harness.actions.setCursor(0.25))
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({ opacity: '0.5' })
			act(() => harness.actions.setCursor(4.75))
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({ opacity: '0.5' })
		} finally {
			unmount()
		}
	})

	it('applies every color preset button in inspector', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			await user.click(screen.getByRole('button', { name: /Sample asset 1/i }))

			const inspector = screen.getByLabelText('Inspector')
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))

			const presets: Array<{ hex: string, rgb: string }> = [
				{ hex: '#2563eb', rgb: 'rgb(37, 99, 235)' },
				{ hex: '#16a34a', rgb: 'rgb(22, 163, 74)' },
				{ hex: '#dc2626', rgb: 'rgb(220, 38, 38)' },
				{ hex: '#ca8a04', rgb: 'rgb(202, 138, 4)' },
				{ hex: '#7c3aed', rgb: 'rgb(124, 58, 237)' },
				{ hex: '#0891b2', rgb: 'rgb(8, 145, 178)' },
			]

			for (const preset of presets) {
				await user.click(within(inspector).getByRole('button', { name: `Set color ${preset.hex}` }))
				expect(within(inspector).getByLabelText('Color')).toHaveValue(preset.hex)
				expect(screen.getByRole('button', { name: /Sample asset 1/i })).toHaveStyle({
					borderLeftColor: preset.rgb,
				})
			}
		}
		finally {
			unmount()
		}
	})

	it('edits clip name, direct color input, and every transform input', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			const inspector = screen.getByLabelText('Inspector')
			fireEvent.change(within(inspector).getByLabelText('Clip name'), { target: { value: 'Renamed clip' } })
			expect(screen.getByRole('button', { name: /Renamed clip/i })).toBeInTheDocument()

			const transformControls = within(inspector).getByLabelText('Transform controls')
			fireEvent.change(within(transformControls).getByLabelText('X'), { target: { value: '24' } })
			fireEvent.change(within(transformControls).getByLabelText('Y'), { target: { value: '-12' } })
			fireEvent.change(within(transformControls).getByLabelText('Scale'), { target: { value: '1.5' } })
			fireEvent.change(within(transformControls).getByLabelText('Rotate'), { target: { value: '15' } })
			expect(within(transformControls).getByLabelText('X')).toHaveValue(24)
			expect(within(transformControls).getByLabelText('Y')).toHaveValue(-12)
			expect(within(transformControls).getByLabelText('Scale')).toHaveValue(1.5)
			expect(within(transformControls).getByLabelText('Rotate')).toHaveValue(15)
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle(
				'transform: translate(24px, -12px) scale(1.5) rotate(15deg)',
			)

			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			fireEvent.change(within(inspector).getByLabelText('Color'), { target: { value: '#dc2626' } })
			expect(within(inspector).getByLabelText('Color')).toHaveValue('#dc2626')
			expect(screen.getByRole('button', { name: /Renamed clip/i })).toHaveStyle({
				borderLeftColor: 'rgb(220, 38, 38)',
			})
		} finally {
			unmount()
		}
	})

	it('keeps projects isolated when switching active project', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			const projectsRegion = screen.getByLabelText('Projects')
			const sourceProjectName = within(projectsRegion).getByRole('button').textContent?.trim() ?? 'Project 1'
			await importSampleResource(harness)

			await createProjectFromMenu(user)
			// Open project switcher to inspect all projects (trigger shows active "Project 2")
			await user.click(within(projectsRegion).getByRole('button', { name: /Project \d+/i }))
			const projectList = within(projectsRegion).getByRole('list')
			const projectButtons = within(projectList).getAllByRole('button', { name: /Project \d+/i })
			expect(projectButtons.length).toBeGreaterThanOrEqual(2)
			expect(screen.queryByRole('button', { name: /Sample asset 1/i })).not.toBeInTheDocument()

			await importSampleResource(harness)
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			await user.click(within(projectList).getByRole('button', { name: new RegExp(sourceProjectName, 'i') }))
			expect(screen.getByRole('button', { name: /Sample asset 1 · 0.0s/i })).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('shows project items in dropdown after opening switcher', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await createProjectFromMenu(user)

			const projectsRegion = screen.getByLabelText('Projects')
			await user.click(within(projectsRegion).getByRole('button', { name: /Project \d+/i }))

			const projectList = within(projectsRegion).getByRole('list')
			expect(within(projectList).getByRole('button', { name: /Project 1/i })).toBeVisible()
			expect(within(projectList).getByRole('button', { name: /Project 2/i })).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('covers toolbar history/export, media controls, and timeline tool toggles', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			expect(screen.queryByRole('button', { name: 'Import sample' })).not.toBeInTheDocument()
			expect(screen.getByRole('button', { name: 'Export project' })).toBeEnabled()

			await importSampleResource(harness)
			await importSampleResource(harness)
			await importSampleResource(harness)
			await user.click(screen.getByRole('button', { name: 'Undo' }))
			expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()
			await user.click(screen.getByRole('button', { name: 'Redo' }))
			expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
			await user.click(screen.getByRole('button', { name: 'Export project' }))
			expect(await screen.findByRole('status')).toHaveTextContent('Export ready')

			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('3 of 3 assets')).toBeInTheDocument()
			await user.click(within(mediaBin).getByRole('button', { name: 'Grid view' }))
			expect(within(mediaBin).getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
			await user.click(within(mediaBin).getByRole('button', { name: 'List view' }))
			expect(within(mediaBin).getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')

			fireEvent.change(within(mediaBin).getByLabelText('Filter media kind'), { target: { value: 'audio' } })
			expect(within(mediaBin).getByText('Sample asset 2', { selector: 'strong' })).toBeInTheDocument()
			expect(within(mediaBin).queryByText('Sample asset 1', { selector: 'strong' })).not.toBeInTheDocument()
			fireEvent.change(within(mediaBin).getByLabelText('Search media'), { target: { value: 'asset 2' } })
			expect(within(mediaBin).getByText('1 of 3 assets')).toBeInTheDocument()

			const timeline = screen.getByLabelText('Timeline')
			const scrollArea = timeline.querySelector('.ve-timeline-scroll-area') as HTMLDivElement | null
			expect(scrollArea).not.toBeNull()
			expect(within(timeline).getByRole('button', { name: 'Select tool' })).toHaveAttribute('aria-pressed', 'true')
			await user.click(within(timeline).getByRole('button', { name: 'Trim tool' }))
			expect(scrollArea).toHaveAttribute('data-tool', 'trim')
			expect(within(timeline).getByRole('button', { name: 'Trim tool' })).toHaveAttribute('aria-pressed', 'true')
			await user.click(within(timeline).getByRole('button', { name: 'Split tool' }))
			expect(scrollArea).toHaveAttribute('data-tool', 'split')
			await user.click(within(timeline).getByRole('button', { name: 'Hand tool' }))
			expect(scrollArea).toHaveAttribute('data-tool', 'hand')

			const snappingButton = within(timeline).getByRole('button', { name: 'Toggle snapping' })
			expect(snappingButton).toHaveAttribute('aria-pressed', 'true')
			await user.click(snappingButton)
			expect(snappingButton).toHaveAttribute('aria-pressed', 'false')
			expect(scrollArea).toHaveAttribute('data-snapping', 'off')

			const v1Controls = within(timeline).getByLabelText('V1 controls')
			expect(within(v1Controls).getByRole('button', { name: 'Track audible' })).toBeDisabled()
			expect(within(v1Controls).getByRole('button', { name: 'Track unlocked' })).toBeDisabled()
			expect(within(v1Controls).getByRole('button', { name: 'Track visible' })).toBeDisabled()
		} finally {
			unmount()
		}
	})

	it('switches inspector tabs for clip editing modes', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)
			await user.click(screen.getByRole('button', { name: /Sample asset 1/i }))

			const inspector = screen.getByLabelText('Inspector')
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			expect(within(inspector).getByLabelText('Color inspector')).toBeVisible()
			expect(within(inspector).getByLabelText('Color presets')).toBeVisible()

			await user.click(within(inspector).getByRole('tab', { name: 'Audio' }))
			expect(within(inspector).getByLabelText('Audio inspector')).toHaveTextContent('Select an audio clip')

			await user.click(within(inspector).getByRole('tab', { name: 'Export' }))
			expect(within(inspector).getByLabelText('Export inspector')).toHaveTextContent('Queue clip export')
			await user.click(within(inspector).getByRole('button', { name: 'Queue clip export' }))
			expect(await within(inspector).findByRole('status')).toHaveTextContent(/Export ready: \d+ frames/)

			await user.click(within(inspector).getByRole('tab', { name: 'Edit' }))
			expect(within(inspector).getByLabelText('Transform controls')).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('controls cursor from the timeline and syncs preview state', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await importSampleResource(harness)

			const timeline = screen.getByLabelText('Timeline')
			setTimelineCursor(timeline, 4.5)

			expect(within(timeline).getByLabelText('Current time')).toHaveTextContent('4.50s')
			expect(within(timeline).getAllByLabelText('Current step')).toHaveLength(1)
			expect(within(screen.getByLabelText('Preview panel')).queryByRole('slider', { name: 'Cursor' })).toBeNull()
			expect(within(screen.getByLabelText('Preview panel')).getByText('Cursor at 4.5s')).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('handles empty timeline and renders a large number of clips without UI breakage', async () => {
		const { harness, user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			expect(screen.getAllByText('Drop clips here.')).toHaveLength(2)
			expect(screen.queryByRole('button', { name: 'Add first resource' })).not.toBeInTheDocument()

			for (let index = 0; index < 100; index += 1) {
				await act(async () => {
					harness.actions.importSampleResource()
					await Promise.resolve()
					await Promise.resolve()
					if (index > 0) {
						const registry = harness.projects$.get()
						const project = getActiveProject(registry, harness.session$.get())
						expect(project).not.toBeNull()
						const resources = getResourceEntities(registry, project!)
						harness.actions.addResourceToTimeline(resources[resources.length - 1].id)
						await Promise.resolve()
						await Promise.resolve()
					}
				})
			}

			expect(screen.getAllByRole('button', { name: /Sample asset/i }).length).toBeGreaterThanOrEqual(100)
			expect(screen.getByLabelText('Timeline')).toBeVisible()
		} finally {
			unmount()
		}
	})
})