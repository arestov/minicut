import { nanoid } from 'nanoid'
import type { ProjectId } from './types'

const createId = (): string => nanoid(12)

export const createProjectId = (): ProjectId => createId()

export const createEntityId = (): string => createId()
