import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VideoEditorHarnessApp } from '../app/VideoEditorHarnessApp'
import { createVideoEditorHarness } from '../app/createVideoEditorHarness'

export const renderVideoEditor = () => {
	const harness = createVideoEditorHarness()
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
