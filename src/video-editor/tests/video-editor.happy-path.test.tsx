import { act, fireEvent, screen, within } from '@testing-library/react'
import { getActiveProject, getResourceEntities } from '../domain/selectors'
import { renderVideoEditor } from './renderVideoEditor'

const createProjectFromMenu = async (user: ReturnType<typeof renderVideoEditor>['user']) => {
	const projectsRegion = screen.getByLabelText('Projects')
	await user.click(within(projectsRegion).getByRole('button'))
	await user.click(within(projectsRegion).getByRole('button', { name: 'New project' }))
}

describe('video editor harness', () => {
	it('runs the happy path: project -> import -> clip -> inspect -> split -> nudge', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			expect(screen.getByRole('button', { name: /Project \d+/i })).toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
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
			const cursorSlider = within(timeline).getByRole('slider', { name: 'Cursor' })
			fireEvent.change(cursorSlider, { target: { value: '2.75' } })

			await user.click(within(inspector).getByRole('button', { name: 'Split clip' }))
			expect(screen.getAllByRole('button', { name: /Sample asset 1/i })).toHaveLength(2)

			await user.click(within(inspector).getByRole('button', { name: 'Nudge +0.5s' }))
			expect(screen.getByText('3.3s')).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('splits clip at playhead and updates timeline clip widths from resulting durations', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))

			const clipButton = screen.getByRole('button', { name: /Sample asset 1/i })
			await user.click(clipButton)

			const timeline = screen.getByLabelText('Timeline')
			const cursorSlider = within(timeline).getByRole('slider', { name: 'Cursor' })
			fireEvent.change(cursorSlider, { target: { value: '1.25' } })

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

	it('deletes selected clips through the inspector', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
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
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
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

	it('applies every color preset button in inspector', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
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

	it('keeps projects isolated when switching active project', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			const projectsRegion = screen.getByLabelText('Projects')
			const sourceProjectName = within(projectsRegion).getByRole('button').textContent?.trim() ?? 'Project 1'
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))

			await createProjectFromMenu(user)
			// Open project switcher to inspect all projects (trigger shows active "Project 2")
			await user.click(within(projectsRegion).getByRole('button', { name: /Project \d+/i }))
			const projectList = within(projectsRegion).getByRole('list')
			const projectButtons = within(projectList).getAllByRole('button', { name: /Project \d+/i })
			expect(projectButtons.length).toBeGreaterThanOrEqual(2)
			expect(screen.queryByRole('button', { name: /Sample asset 1/i })).not.toBeInTheDocument()

			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			const mediaBin = screen.getByLabelText('Media bin')
			expect(within(mediaBin).getByText('Sample asset 1', { selector: 'strong' })).toBeInTheDocument()

			await user.click(within(projectList).getByRole('button', { name: new RegExp(sourceProjectName, 'i') }))
			expect(screen.getByRole('button', { name: /Sample asset 1 · 0.0s/i })).toBeInTheDocument()
		} finally {
			unmount()
		}
	})

	it('shows project items in dropdown after opening switcher', async () => {
		const { user, unmount } = renderVideoEditor()

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

	it('switches inspector tabs for clip editing modes', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))
			await user.click(screen.getByRole('button', { name: /Sample asset 1/i }))

			const inspector = screen.getByLabelText('Inspector')
			await user.click(within(inspector).getByRole('tab', { name: 'Color' }))
			expect(within(inspector).getByLabelText('Color inspector')).toBeVisible()
			expect(within(inspector).getByLabelText('Color presets')).toBeVisible()

			await user.click(within(inspector).getByRole('tab', { name: 'Audio' }))
			expect(within(inspector).getByLabelText('Audio inspector')).toHaveTextContent('Audio controls')

			await user.click(within(inspector).getByRole('tab', { name: 'Export' }))
			expect(within(inspector).getByLabelText('Export inspector')).toHaveTextContent('Queue clip export')
			await user.click(within(inspector).getByRole('button', { name: 'Queue clip export' }))
			expect(within(inspector).getByRole('status')).toHaveTextContent('Queued export for Sample asset 1')

			await user.click(within(inspector).getByRole('tab', { name: 'Edit' }))
			expect(within(inspector).getByLabelText('Transform controls')).toBeVisible()
		} finally {
			unmount()
		}
	})

	it('controls cursor from the timeline and syncs preview state', async () => {
		const { user, unmount } = renderVideoEditor()

		try {
			await createProjectFromMenu(user)
			await user.click(screen.getByRole('button', { name: 'Import sample' }))
			await user.click(screen.getByRole('button', { name: 'Add to timeline' }))

			const timeline = screen.getByLabelText('Timeline')
			const cursorSlider = within(timeline).getByRole('slider', { name: 'Cursor' })
			fireEvent.change(cursorSlider, { target: { value: '4.5' } })

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

			for (let index = 0; index < 100; index += 1) {
				await act(async () => {
					harness.actions.importSampleResource()
					await Promise.resolve()
					await Promise.resolve()
					const registry = harness.projects$.get()
					const project = getActiveProject(registry, harness.session$.get())
					expect(project).not.toBeNull()
					const resources = getResourceEntities(registry, project!)
					harness.actions.addResourceToTimeline(resources[resources.length - 1].id)
					await Promise.resolve()
					await Promise.resolve()
				})
			}

			expect(screen.getAllByRole('button', { name: /Sample asset/i }).length).toBeGreaterThanOrEqual(100)
			expect(screen.getByLabelText('Timeline')).toBeVisible()
		} finally {
			unmount()
		}
	})
})