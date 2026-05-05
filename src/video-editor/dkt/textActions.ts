import type { TextAttrs } from '../domain/types'

export type DktTextActionName = 'updateText'
export type DktTextActionPatch = Partial<TextAttrs>

export const defaultTextStyle: TextAttrs['style'] = {
	fontFamily: 'Inter, Segoe UI, sans-serif',
	fontSize: 64,
	fontWeight: 700,
	lineHeight: 1.1,
	letterSpacing: 0,
	color: '#ffffff',
	backgroundColor: 'rgba(0, 0, 0, 0)',
	align: 'center',
}

export const defaultTextBox: TextAttrs['box'] = {
	width: 760,
	height: 220,
}

export const reduceDktTextAction = (
	payload: unknown,
	current: Pick<TextAttrs, 'style' | 'box'>,
): DktTextActionPatch | null => {
	const attrs = payload as Partial<TextAttrs> | null
	if (!attrs || typeof attrs !== 'object') {
		return null
	}

	return {
		...attrs,
		...(attrs.style ? { style: { ...current.style, ...attrs.style } } : {}),
		...(attrs.box ? { box: { ...current.box, ...attrs.box } } : {}),
	}
}
