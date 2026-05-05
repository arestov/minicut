import { type ComponentProps, type ComponentType, createElement } from 'react'
import { MountedShape } from './MountedShape'

const SHAPE_META = Symbol.for('dkt.react_sync.shape')

let nextShapeId = 1

export type ReactShapeSpec = {
  attrs?: readonly string[]
  rels?: readonly string[]
  one?: Record<string, DefinedReactShape>
  many?: Record<string, DefinedReactShape>
}

export type DefinedReactShape = Readonly<ReactShapeSpec> & {
  readonly id: string
}

export const defineShape = (shape: ReactShapeSpec): DefinedReactShape => {
  const normalized: DefinedReactShape = Object.freeze({
    attrs: Object.freeze([...(shape.attrs ?? [])]),
    rels: Object.freeze([...(shape.rels ?? [])]),
    one: Object.freeze({ ...(shape.one ?? {}) }),
    many: Object.freeze({ ...(shape.many ?? {}) }),
    id: `shape-${nextShapeId++}`,
  })

  return normalized
}

export const shapeOf = <T extends ComponentType<any>>(component: T, shape: DefinedReactShape) => {
  Object.defineProperty(component, SHAPE_META, {
    value: shape,
    configurable: true,
  })

  const WrappedComponent = (props: ComponentProps<T>) =>
    createElement(MountedShape, {
      shape,
      children: createElement(component as ComponentType<any>, props),
    })

  WrappedComponent.displayName = component.displayName || component.name || 'ShapedComponent'

  Object.defineProperty(WrappedComponent, SHAPE_META, {
    value: shape,
    configurable: true,
  })

  return WrappedComponent as unknown as T
}

export const getShapeOf = (component: ComponentType<any>) =>
  (
    component as ComponentType<any> & {
      [SHAPE_META]?: DefinedReactShape
    }
  )[SHAPE_META] ?? null