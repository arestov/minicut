import { type DefinedReactShape, defineShape } from './defineShape'

const attrsShapesByKey = new Map<string, DefinedReactShape>()
const relShapesByName = new Map<string, DefinedReactShape>()

export const getAttrsShape = (attrs: readonly string[]) => {
  const key = attrs.join('\u001f')
  const cached = attrsShapesByKey.get(key)

  if (cached) {
    return cached
  }

  const shape = defineShape({ attrs })
  attrsShapesByKey.set(key, shape)

  return shape
}

export const getRelShape = (relName: string) => {
  const cached = relShapesByName.get(relName)

  if (cached) {
    return cached
  }

  const shape = defineShape({ rels: [relName] })
  relShapesByName.set(relName, shape)

  return shape
}