import React from 'react'
import ReactDOM from 'react-dom/client'
import { VideoEditorHarnessApp } from './VideoEditorHarnessApp'
import { createMiniCutEditorSession } from '../page/createMiniCutEditorSession'

const rootElement = document.getElementById('root')

if (!rootElement) {
	throw new Error('missing #root element')
}

const session = createMiniCutEditorSession()
const meta = import.meta as ImportMeta & {
	env?: { DEV?: boolean }
	hot?: { dispose(callback: () => void): void }
}

session.bootstrap()

if (meta.env?.DEV && typeof window !== 'undefined') {
	Object.assign(window as Window & { __minicutSync?: unknown }, {
		__minicutSync: {
			session,
			dumpGraph: () => session.dumpGraph(),
			describeNode: (nodeId: string) => session.describeNode(nodeId),
			messages: () => session.messages(),
			snapshot: () => session.snapshot(),
		},
	})
}

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<VideoEditorHarnessApp harness={session.harness} dktBootstrapOptions={null} />
	</React.StrictMode>,
)

if (meta.hot) {
	meta.hot.dispose(() => {
		if (typeof window !== 'undefined') {
			const target = window as Window & { __minicutSync?: unknown }
			const current = target.__minicutSync as { session?: unknown } | undefined
			if (current?.session === session) {
				delete target.__minicutSync
			}
		}
		session.destroy()
	})
}
