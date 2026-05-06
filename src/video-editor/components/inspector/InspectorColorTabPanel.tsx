import { Palette, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScopeContext } from '../../../dkt-react-sync/context/ScopeContext'
import { useAttrs } from '../../../dkt-react-sync/hooks/useAttrs'
import { useMany } from '../../../dkt-react-sync/hooks/useMany'
import { useVideoEditor } from '../../app/VideoEditorContext'
import { readVideoFrameImageData } from '../../color/framePalette'
import { buildLookColorCorrectionParams, getLookPreset, lookPresets } from '../../color/looks'
import type { AnimatedScalar } from '../../render/registryTypes'
import type { ColorCorrectionAttrs, EffectAttrs } from '../../models/Effect/types'
import { Button } from '../ControlPrimitives'
import { LookBrowser } from '../LookBrowser'
import type { PreviewMediaElementRegistry } from '../mediaElementRegistry'
import LookThumbnailWorker from '../lookThumbnailWorker?worker'
import { InspectorSection } from './InspectorSection'
import type { ClipRenderAttrs, ColorParamKey, PrimaryColorParam } from './types'
import { colorGradePresets, defaultColorCorrectionParams } from './types'

const ColorCorrectionControls = ({ mediaElementRegistry }: { mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const [isComparePressed, setIsComparePressed] = useState(false)
	const [lookThumbnails, setLookThumbnails] = useState<Record<string, string>>({})
	const compareRestoreEnabledRef = useRef<boolean | null>(null)
	const { actions } = useVideoEditor()
	const colorCorrectionAttrs = useAttrs(['sourceEffectId', 'enabled', 'params']) as unknown as EffectAttrs & { sourceEffectId?: unknown }
	const effectId = typeof colorCorrectionAttrs.sourceEffectId === 'string' ? colorCorrectionAttrs.sourceEffectId : null
	const colorParams = (colorCorrectionAttrs.params ?? {}) as Partial<ColorCorrectionAttrs>
	const isColorCorrectionEnabled = colorCorrectionAttrs.enabled !== false
	const activeLookId = typeof (colorParams as Record<string, unknown>).lookId === 'string' ? String((colorParams as Record<string, unknown>).lookId) : 'clean'
	const activeLookIdRef = useRef(activeLookId)

	useEffect(() => {
		activeLookIdRef.current = activeLookId
	}, [activeLookId])

	const getParamValue = (key: ColorParamKey, fallback: number): number => Number((colorParams[key] as AnimatedScalar | undefined)?.value ?? fallback)
	const updateColorParams = (params: Partial<Record<ColorParamKey, number>> & Record<string, unknown> = {}): void => {
		if (!effectId) {
			return
		}
		const nextParams: Record<string, unknown> = { ...colorParams }
		for (const [key, value] of Object.entries(params)) {
			nextParams[key] = typeof value === 'number' ? { value } : value
		}
		actions.updateEffectAttrs(effectId, { params: { ...nextParams } })
	}

	const updateParam = (key: PrimaryColorParam, value: number): void => {
		activeLookIdRef.current = 'custom'
		updateColorParams({ [key]: value, lookId: 'custom' })
	}

	const lookIntensity = Number(((colorParams as Record<string, { value?: unknown }>).lookIntensity)?.value ?? 1)
	const applyLook = (nextLookId: string, nextIntensity = nextLookId === activeLookId ? lookIntensity : 1): void => {
		activeLookIdRef.current = nextLookId
		updateColorParams(buildLookColorCorrectionParams(nextLookId, nextIntensity))
	}

	const updateLookIntensity = (value: number): void => {
		const intensityLookId = activeLookIdRef.current
		const intensityLook = getLookPreset(intensityLookId)
		if (intensityLookId === 'custom' || intensityLook.id === 'clean') {
			return
		}
		updateColorParams(buildLookColorCorrectionParams(intensityLook.id, value))
	}

	const toggleBypass = (): void => {
		if (effectId) {
			actions.updateEffectAttrs(effectId, { enabled: !isColorCorrectionEnabled })
		}
	}
	const resetGrade = (): void => {
		activeLookIdRef.current = 'clean'
		updateColorParams({
			lookId: 'clean',
			lookIntensity: 1,
			exposure: defaultColorCorrectionParams.exposure.value,
			contrast: defaultColorCorrectionParams.contrast.value,
			saturation: defaultColorCorrectionParams.saturation.value,
			temperature: defaultColorCorrectionParams.temperature.value,
			hue: 0,
			gamma: 1,
		})
	}

	const handleCompareStart = (): void => {
		if (!effectId || !isColorCorrectionEnabled || isComparePressed) {
			return
		}
		compareRestoreEnabledRef.current = isColorCorrectionEnabled
		setIsComparePressed(true)
		actions.updateEffectAttrs(effectId, { enabled: false })
	}

	const handleCompareEnd = (): void => {
		if (!effectId || !isComparePressed) {
			return
		}
		const shouldRestoreEnabled = compareRestoreEnabledRef.current
		compareRestoreEnabledRef.current = null
		setIsComparePressed(false)
		actions.updateEffectAttrs(effectId, { enabled: shouldRestoreEnabled !== false })
	}

	useEffect(() => {
		if (!mediaElementRegistry) {
			setLookThumbnails({})
			return
		}
		const video = mediaElementRegistry.getTopmostVideo()
		const frame = video ? readVideoFrameImageData(video, 48) : null
		if (!frame) {
			setLookThumbnails({})
			return
		}
		let isCancelled = false
		const worker = new LookThumbnailWorker()
		worker.onmessage = (event: MessageEvent<{ type: string, thumbnails?: Record<string, string> }>) => {
			if (!isCancelled && event.data.type === 'look-thumbnails-rendered' && event.data.thumbnails) {
				setLookThumbnails(event.data.thumbnails)
			}
		}
		const pixels = new Uint8ClampedArray(frame.data)
		worker.postMessage({
			type: 'render-look-thumbnails',
			width: frame.width,
			height: frame.height,
			pixels,
			looks: lookPresets.map((look) => {
				const { lookId: _lookId, lookIntensity: _lookIntensity, ...params } = buildLookColorCorrectionParams(look.id, lookIntensity)
				return { id: look.id, params }
			}),
		}, [pixels.buffer])
		return () => {
			isCancelled = true
			worker.terminate()
		}
	}, [effectId, lookIntensity, mediaElementRegistry])

	return (
		<>
			<div className="ve-color-grade-actions">
				<Button type="button" variant="secondary" onClick={toggleBypass}>{isColorCorrectionEnabled ? 'Bypass grade' : 'Enable grade'}</Button>
				<Button type="button" variant="outline" onClick={resetGrade}>Reset grade</Button>
				<Button type="button" variant="ghost" onPointerDown={handleCompareStart} onPointerUp={handleCompareEnd} onPointerLeave={handleCompareEnd} onBlur={handleCompareEnd}>Press and hold: Before</Button>
			</div>
			<div className="ve-color-grade-presets" aria-label="Grade presets">
				{colorGradePresets.map((preset) => (
					<Button key={preset.id} type="button" variant="outline" onClick={() => { activeLookIdRef.current = 'custom'; updateColorParams({ ...preset.params, lookId: 'custom', lookIntensity: 1 }) }}>{preset.label}</Button>
				))}
			</div>
			<LookBrowser activeLookId={activeLookId} intensity={lookIntensity} thumbnails={lookThumbnails} onApplyLook={applyLook} onIntensityChange={updateLookIntensity} />
			<label className="ve-slider-field"><span>Exposure</span><input type="range" aria-label="Exposure" min="-100" max="100" value={Math.round(getParamValue('exposure', 0) * 100)} onChange={(event) => updateParam('exposure', Number(event.currentTarget.value) / 100)} /></label>
			<label className="ve-slider-field"><span>Contrast</span><input type="range" aria-label="Contrast" min="0" max="200" value={Math.round(getParamValue('contrast', 1) * 100)} onChange={(event) => updateParam('contrast', Number(event.currentTarget.value) / 100)} /></label>
			<label className="ve-slider-field"><span>Saturation</span><input type="range" aria-label="Saturation" min="0" max="250" value={Math.round(getParamValue('saturation', 1) * 100)} onChange={(event) => updateParam('saturation', Number(event.currentTarget.value) / 100)} /></label>
			<label className="ve-slider-field"><span>Temperature</span><input type="range" aria-label="Temperature" min="-100" max="100" value={Math.round(getParamValue('temperature', 0) * 100)} onChange={(event) => updateParam('temperature', Number(event.currentTarget.value) / 100)} /></label>
			<small>{isColorCorrectionEnabled ? 'Grade active' : 'Grade bypassed'} В· Exposure {getParamValue('exposure', 0).toFixed(2)} В· Contrast {getParamValue('contrast', 1).toFixed(2)} В· Saturation {getParamValue('saturation', 1).toFixed(2)}</small>
		</>
	)
}

const ColorCorrectionEffectSlot = ({
	effectNodeId,
	mediaElementRegistry,
	onPresenceChange,
}: {
	effectNodeId: string
	mediaElementRegistry?: PreviewMediaElementRegistry
	onPresenceChange: (effectNodeId: string, present: boolean) => void
}) => {
	const attrs = useAttrs(['kind']) as { kind?: unknown }
	const isColorCorrection = attrs.kind === 'color-correction'

	useEffect(() => {
		onPresenceChange(effectNodeId, isColorCorrection)
		return () => onPresenceChange(effectNodeId, false)
	}, [effectNodeId, isColorCorrection, onPresenceChange])

	return isColorCorrection ? <ColorCorrectionControls mediaElementRegistry={mediaElementRegistry} /> : null
}

export const InspectorColorTabPanel = ({ mediaElementRegistry }: { mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const { actions } = useVideoEditor()
	const clipAttrs = useAttrs(['sourceClipId', 'color']) as ClipRenderAttrs & { sourceClipId?: unknown }
	const effectScopes = useMany('effects')
	const [colorCorrectionEffectIds, setColorCorrectionEffectIds] = useState<ReadonlySet<string>>(() => new Set())
	const sourceClipId = typeof clipAttrs.sourceClipId === 'string' ? clipAttrs.sourceClipId : null
	const color = String(clipAttrs.color ?? '#2563eb')
	const hasColorCorrectionEffect = colorCorrectionEffectIds.size > 0
	const handleColorCorrectionPresence = useCallback((effectNodeId: string, present: boolean) => {
		setColorCorrectionEffectIds((current) => {
			const next = new Set(current)
			if (present) {
				next.add(effectNodeId)
			} else {
				next.delete(effectNodeId)
			}
			return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next
		})
	}, [])

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Color inspector">
			<InspectorSection title="Label color" icon={Palette}>
				<label className="ve-color-field"><span>Clip label</span><input type="color" aria-label="Color" value={color} onChange={(event) => sourceClipId ? actions.colorClipById(sourceClipId, event.currentTarget.value) : undefined} /></label>
				<div className="ve-swatch-grid" aria-label="Color presets">
					{['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#7c3aed', '#0891b2'].map((swatch) => (<button key={swatch} type="button" aria-label={`Set color ${swatch}`} style={{ background: swatch }} onClick={() => sourceClipId ? actions.colorClipById(sourceClipId, swatch) : undefined} />))}
				</div>
			</InspectorSection>
			<InspectorSection title="Primary correction" icon={SlidersHorizontal} ariaLabel="Primary color correction">
				{effectScopes.map((effectScope) => (
					<ScopeContext.Provider key={effectScope._nodeId} value={effectScope}>
						<ColorCorrectionEffectSlot
							effectNodeId={effectScope._nodeId}
							mediaElementRegistry={mediaElementRegistry}
							onPresenceChange={handleColorCorrectionPresence}
						/>
					</ScopeContext.Provider>
				))}
				{!hasColorCorrectionEffect ? (
					<Button type="button" variant="secondary" onClick={() => sourceClipId ? actions.addColorCorrectionToClip(sourceClipId) : undefined}>Add primary correction</Button>
				) : null}
			</InspectorSection>
		</div>
	)
}

