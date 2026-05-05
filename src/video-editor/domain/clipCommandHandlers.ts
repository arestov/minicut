import { asClipAttrs, type CommandHandler } from './applyCommandHelpers'
import { assertEntity, assertProjectForEntity } from './validateCommand'
import { CMD, PATCH, type ClipAttrs, type Command, type Patch } from './types'

type CommandByCode<Code extends Command['c']> = Extract<Command, { c: Code }>

export const handleClipUpdateAttrs: CommandHandler<CommandByCode<typeof CMD.CLIP_UPDATE_ATTRS>> = (registry, command) => {
	const project = assertProjectForEntity(registry, command.p.id)
	const clip = assertEntity(registry, command.p.id)
	const { opacity, transform, ...attrsWithoutTransform } = command.p.attrs
	const attrs: Partial<ClipAttrs> = { ...attrsWithoutTransform }
	const patches: Patch[] = []
	const clipAttrs = asClipAttrs(clip.attrs)

	const transformMergeAttrs: Record<string, unknown> = {}
	if (transform) {
		for (const key of ['x', 'y', 'scale', 'rotation'] as const) {
			const incoming = transform[key]
			if (!incoming) {
				continue
			}

			if (incoming.value !== undefined) {
				patches.push({ c: PATCH.SCALAR_SET, p: { id: command.p.id, path: `transform.${key}.value`, value: incoming.value } })
			}

			const { value: _value, ...incomingRest } = incoming
			if (Object.keys(incomingRest).length > 0) {
				transformMergeAttrs[key] = {
					...(clipAttrs.transform[key] as unknown as Record<string, unknown>),
					...incomingRest,
				}
			}
		}
	}

	if (Object.keys(transformMergeAttrs).length > 0) {
		attrs.transform = { ...clipAttrs.transform, ...transformMergeAttrs }
	}

	if (Object.keys(attrs).length > 0) {
		patches.push({ c: PATCH.ATTRS_MERGE, p: { id: command.p.id, attrs } })
	}

	if (opacity?.value !== undefined) {
		patches.push({ c: PATCH.SCALAR_SET, p: { id: command.p.id, path: 'opacity.value', value: opacity.value } })
	}

	return {
		envelope: { projectId: project.id, version: project.version + 1, patches },
	}
}
