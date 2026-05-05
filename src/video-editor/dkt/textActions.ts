import type { TextAttrs } from '../domain/types'

export type DktTextActionName = 'setTextContent' | 'setTextStyle' | 'setTextBox'
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

export const reduceTextContentAction = (payload: unknown): Pick<TextAttrs, 'content'> | null => {
	const content = typeof payload === 'string'
		? payload
		: (payload as { content?: unknown } | null)?.content
	return typeof content === 'string' ? { content } : null
}

export const reduceTextStyleAction = (
	payload: unknown,
	current: Pick<TextAttrs, 'style'>,
): Pick<TextAttrs, 'style'> | null => {
	const style = (payload as { style?: unknown } | null)?.style ?? payload
	return style && typeof style === 'object'
		? { style: { ...current.style, ...(style as Partial<TextAttrs['style']>) } }
		: null
}

export const reduceTextBoxAction = (
	payload: unknown,
	current: Pick<TextAttrs, 'box'>,
): Pick<TextAttrs, 'box'> | null => {
	const box = (payload as { box?: unknown } | null)?.box ?? payload
	return box && typeof box === 'object'
		? { box: { ...current.box, ...(box as Partial<TextAttrs['box']>) } }
		: null
}
