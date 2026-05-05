import { useEffect } from 'react'
import { RootScope } from '../../../dkt-react-sync/scope/RootScope'
import type { PageSyncRuntime } from '../../../dkt-react-sync/runtime/PageSyncRuntime'

export const DktEditorRoot = ({
	runtime,
	children,
}: {
	runtime: PageSyncRuntime | null
	children: React.ReactNode
}) => {
	useEffect(() => {
		runtime?.bootstrap({ sessionKey: 'minicut-local' })
	}, [runtime])

	if (!runtime) {
		return <>{children}</>
	}

	return (
		<RootScope runtime={runtime}>
			{children}
		</RootScope>
	)
}
