import { inspectorTabs, type InspectorTab } from './types'

export const InspectorTabs = ({ activeTab, onChange, disabled = false }: {
	activeTab: InspectorTab
	onChange: (tab: InspectorTab) => void
	disabled?: boolean
}) => (
	<div className="ve-inspector-tabs" role="tablist" aria-label="Inspector tabs">
		{inspectorTabs.map((tab) => (
			<button
				key={tab.id}
				type="button"
				role="tab"
				aria-selected={tab.id === activeTab}
				className={tab.id === activeTab ? 'is-active' : ''}
				onClick={() => onChange(tab.id)}
				disabled={disabled}
			>
				{tab.label}
			</button>
		))}
	</div>
)
