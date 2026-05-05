import { Palette, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useVideoEditor } from '../../app/VideoEditorContext'
import { buildLookColorCorrectionParams, getLookPreset, lookPresets } from '../../color/looks'
import type { AnimatedScalar, ColorCorrectionAttrs, EffectAttrs } from '../../domain/types'
import { useEditorAttrs, useEditorComp, useEditorMany } from '../../render-sync'
import type { EditorScope } from '../../render-sync/EditorScope'
import { Button } from '../ControlPrimitives'
import { LookBrowser } from '../LookBrowser'
import type { PreviewMediaElementRegistry } from '../mediaElementRegistry'
import LookThumbnailWorker from '../lookThumbnailWorker?worker'
import { readVideoFrameImageData } from '../../color/framePalette'
import { InspectorSection } from './InspectorSection'
import type {
	ClipRenderAttrs,
	ColorParamKey,
	PrimaryColorParam,
} from './types'
import {
	colorGradePresets,
	defaultColorCorrectionParams,
} from './types'

const ColorCorrectionControls = ({ effectScope, mediaElementRegistry }: { effectScope: EditorScope; mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const [isComparePressed, setIsComparePressed] = useState(false)
	const [lookThumbnails, setLookThumbnails] = useState<Record<string, string>>({})
	const compareRestoreEnabledRef = useRef<boolean | null>(null)
	const { actions } = useVideoEditor()
	const colorCorrectionAttrs = useEditorAttrs<EffectAttrs>(['enabled', 'params'], effectScope)
	const colorParams = (colorCorrectionAttrs.params ?? {}) as Partial<ColorCorrectionAttrs>
	const isColorCorrectionEnabled = colorCorrectionAttrs.enabled !== false
	const activeLookId = typeof (colorParams as Record<string, unknown>).lookId === 'string' ? String((colorParams as Record<string, unknown>).lookId) : 'clean'
	const activeLookIdRef = useRef(activeLookId)

	useEffect(() => {
		activeLookIdRef.current = activeLookId
	}, [activeLookId])

	const getParamValue = (key: ColorParamKey, fallback: number): number => Number((colorParams[key] as AnimatedScalar | undefined)?.value ?? fallback)
	const updateColorParams = (params: Partial<Record<ColorParamKey, number>> & Record<string, unknown> = {}): void => {
		const nextParams: Record<string, unknown> = { ...colorParams }
		for (const [key, value] of Object.entries(params)) {
			nextParams[key] = typeof value === 'number' ? { value } : value
		}
		actions.updateEffectAttrs(effectScope.nodeId, { params: { ...nextParams } })
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

	const toggleBypass = (): void => actions.updateEffectAttrs(effectScope.nodeId, { enabled: !isColorCorrectionEnabled })
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
		if (!isColorCorrectionEnabled || isComparePressed) {
			return
		}
		compareRestoreEnabledRef.current = isColorCorrectionEnabled
		setIsComparePressed(true)
		actions.updateEffectAttrs(effectScope.nodeId, { enabled: false })
	}

	const handleCompareEnd = (): void => {
		if (!isComparePressed) {
			return
		}
		const shouldRestoreEnabled = compareRestoreEnabledRef.current
		compareRestoreEnabledRef.current = null
		setIsComparePressed(false)
		actions.updateEffectAttrs(effectScope.nodeId, { enabled: shouldRestoreEnabled !== false })
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
	}, [effectScope.nodeId, lookIntensity, mediaElementRegistry])

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
			<small>{isColorCorrectionEnabled ? 'Grade active' : 'Grade bypassed'} · Exposure {getParamValue('exposure', 0).toFixed(2)} · Contrast {getParamValue('contrast', 1).toFixed(2)} · Saturation {getParamValue('saturation', 1).toFixed(2)}</small>
		</>
	)
}

export const InspectorColorTabPanel = ({ clipScope, mediaElementRegistry }: { clipScope: EditorScope, mediaElementRegistry?: PreviewMediaElementRegistry }) => {
	const { actions, renderRuntime } = useVideoEditor()
	const runtime = useEditorComp<boolean>('hasActiveColorGrade', clipScope)
	const clipAttrs = useEditorAttrs<ClipRenderAttrs>(['color'], clipScope)
	const effectScopes = useEditorMany('effects', clipScope)
	const color = String(clipAttrs.color ?? '#2563eb')
	const colorCorrectionEffectScope = effectScopes.find((effectScope) => {
		const attrs = renderRuntime.readAttrs(effectScope, ['kind'])
		return attrs.kind === 'color-correction'
	}) ?? null
	void runtime

	return (
		<div className="ve-inspector-tab-panel" role="tabpanel" aria-label="Color inspector">
			<InspectorSection title="Label color" icon={Palette}>
				<label className="ve-color-field"><span>Clip label</span><input type="color" aria-label="Color" value={color} onChange={(event) => actions.colorSelectedClip(event.currentTarget.value)} /></label>
				<div className="ve-swatch-grid" aria-label="Color presets">
					{['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#7c3aed', '#0891b2'].map((swatch) => (<button key={swatch} type="button" aria-label={`Set color ${swatch}`} style={{ background: swatch }} onClick={() => actions.colorSelectedClip(swatch)} />))}
				</div>
			</InspectorSection>
			<InspectorSection title="Primary correction" icon={SlidersHorizontal} ariaLabel="Primary color correction">
				{colorCorrectionEffectScope ? <ColorCorrectionControls effectScope={colorCorrectionEffectScope} mediaElementRegistry={mediaElementRegistry} /> : <Button type="button" variant="secondary" onClick={() => actions.addColorCorrectionToSelectedClip()}>Add primary correction</Button>}
			</InspectorSection>
		</div>
	)
}
