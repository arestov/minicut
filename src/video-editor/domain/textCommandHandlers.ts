import { mergeTextAttrs, type CommandHandler } from './applyCommandHelpers'
import { assertEntity, assertProjectForEntity } from './validateCommand'
import { CMD, PATCH, type Command, type TextAttrs } from './types'

type CommandByCode<Code extends Command['c']> = Extract<Command, { c: Code }>

export const handleTextUpdateAttrs: CommandHandler<CommandByCode<typeof CMD.TEXT_UPDATE_ATTRS>> = (registry, command) => {
	const project = assertProjectForEntity(registry, command.p.id)
	const text = assertEntity(registry, command.p.id)
	const attrs = mergeTextAttrs(text.attrs as unknown as TextAttrs, command.p.attrs)

	return {
		envelope: {
			projectId: project.id,
			version: project.version + 1,
			patches: [{ c: PATCH.ATTRS_MERGE, p: { id: text.id, attrs } }],
		},
	}
}
