import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VideoEditorHarnessApp } from '../app/VideoEditorHarnessApp'
import { createVideoEditorHarness } from '../app/createVideoEditorHarness'

type RenderVideoEditorOptions = Parameters<typeof createVideoEditorHarness>[1]

export const renderVideoEditor = (options: RenderVideoEditorOptions = {}) => {
	const harness = createVideoEditorHarness(undefined, options)
	const rendered = render(<VideoEditorHarnessApp harness={harness} />)
	const user = userEvent.setup()
	const originalUnmount = rendered.unmount

	return {
		...rendered,
		harness,
		user,
		unmount: () => {
			harness.destroy()
			originalUnmount()
		},
	}
}
