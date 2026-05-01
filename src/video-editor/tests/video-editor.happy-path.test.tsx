import { fireEvent, screen, within } from '@testing-library/react'
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
			const opacitySlider = within(inspector).getByRole('slider', { name: 'Opacity' })
			expect(opacitySlider).toBeInTheDocument()
			fireEvent.change(opacitySlider, { target: { value: '60' } })

			expect(screen.getByText('60%', { selector: 'dd' })).toBeInTheDocument()
			await user.click(within(inspector).getByRole('button', { name: 'Blur' }))
			expect(within(inspector).getByText('1 effects')).toBeInTheDocument()
			expect(screen.getByLabelText('Renderer stage').querySelector('.ve-renderer__layer')).toHaveStyle({
				filter: 'blur(3px)',
			})

			await user.click(within(inspector).getByRole('button', { name: 'Start +0.5s' }))
			expect(screen.getByText('0.5s', { selector: 'dd' })).toBeInTheDocument()

			const transformControls = within(inspector).getByLabelText('Transform controls')
			fireEvent.change(within(transformControls).getByLabelText('X'), { target: { value: '24' } })
			expect(within(transformControls).getByLabelText('X')).toHaveValue(24)

			await user.click(within(inspector).getByRole('button', { name: 'Split clip' }))
			expect(screen.getAllByRole('button', { name: /Sample asset 1/i })).toHaveLength(2)

			await user.click(within(inspector).getByRole('button', { name: 'Nudge +0.5s' }))
			expect(screen.getByText('3.3s')).toBeInTheDocument()
		} finally {
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
})