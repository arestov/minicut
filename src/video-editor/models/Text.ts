import { model } from 'dkt/model.js'
import { reduceTextBoxAction, reduceTextContentAction, reduceTextStyleAction } from './Text/actions'
import { defaultTextBox, defaultTextStyle } from './Text/defaults'

export const Text = model({
	model_name: 'minicut_text',
	attrs: {
		sourceTextId: ['input', null],
		renderAttrs: ['comp', ['sourceTextId', 'content', 'style', 'box'] as const,
			(sourceTextId: unknown, content: unknown, style: unknown, box: unknown) => ({
				sourceTextId: typeof sourceTextId === 'string' ? sourceTextId : '',
				content: typeof content === 'string' ? content : '',
				style: style && typeof style === 'object' ? style as Record<string, unknown> : {},
				box: box && typeof box === 'object' ? box as Record<string, unknown> : {},
			})],
		content: ['input', 'Text'],
		style: ['input', defaultTextStyle],
		box: ['input', defaultTextBox],
	},
	rels: {
		clip: ['input', { linking: '<< clip << #' }],
	},
	actions: {
		setTextContent: {
			to: {
				content: ['content'],
			},
			fn: (payload: unknown) => reduceTextContentAction(payload) ?? '$noop',
		},
		setTextStyle: {
			to: {
				style: ['style'],
			},
			fn: [
				['style'] as const,
				(payload: unknown, style: unknown) => {
					const patch = reduceTextStyleAction(payload, {
						style: style && typeof style === 'object' ? style as typeof defaultTextStyle : defaultTextStyle,
					})
					return patch ?? '$noop'
				},
			],
		},
		setTextBox: {
			to: {
				box: ['box'],
			},
			fn: [
				['box'] as const,
				(payload: unknown, box: unknown) => reduceTextBoxAction(payload, {
					box: box && typeof box === 'object' ? box as typeof defaultTextBox : defaultTextBox,
				}) ?? '$noop',
			],
		},
		setClip: {
			to: {
				clip: ['<< clip', { method: 'set_one' }],
			},
			fn: (payload: unknown) => ({
				clip: (payload as { clip?: unknown } | null)?.clip ?? null,
			}),
		},
	},
})

export const TEXT_CREATION_SHAPE = {
	attrs: ['sourceTextId', 'content', 'style', 'box'],
} as const
