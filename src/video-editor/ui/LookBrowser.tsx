import { lookPresets } from '../color/looks'

export const LookBrowser = ({
	activeLookId,
	intensity,
	thumbnails,
	onApplyLook,
	onIntensityChange,
}: {
	activeLookId: string
	intensity: number
	thumbnails?: Record<string, string>
	onApplyLook: (lookId: string) => void
	onIntensityChange: (intensity: number) => void
}) => {
	const clampedIntensity = Math.max(0, Math.min(1, intensity))
	const activeLook = lookPresets.find((look) => look.id === activeLookId) ?? null
	const activeLabel = activeLook ? activeLook.label : 'Custom'

	return (
		<div className="ve-look-browser" aria-label="Look Browser">
			<div className="ve-look-browser__header">
				<strong>Look Browser</strong>
				<span className="ve-status-pill">{activeLabel} {activeLook ? `${Math.round(clampedIntensity * 100)}%` : 'grade'}</span>
			</div>
			<div className="ve-look-browser__grid">
				{lookPresets.map((look) => (
					<button
						key={look.id}
						type="button"
						className={activeLook?.id === look.id ? 'is-active' : ''}
						aria-label={`Apply look ${look.label}`}
						aria-pressed={activeLook?.id === look.id}
						onClick={() => onApplyLook(look.id)}
					>
						<span className="ve-look-browser__thumb" data-look-id={look.id} style={{ background: thumbnails?.[look.id] ?? look.preview }} />
						<span>{look.label}</span>
					</button>
				))}
			</div>
			<label className="ve-slider-field">
				<span>Look intensity</span>
				<input type="range" aria-label="Look intensity" min="0" max="100" value={Math.round(clampedIntensity * 100)} onChange={(event) => onIntensityChange(Number(event.currentTarget.value) / 100)} />
			</label>
		</div>
	)
}
