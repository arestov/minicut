import { type ComponentProps, type ComponentType, createElement } from "react";
import { MountedShape } from "./MountedShape";

const SHAPE_META = Symbol.for("dkt.react_sync.shape");

let nextShapeId = 1;

export type ReactShapeSpec = {
	attrs?: readonly string[];
	rels?: readonly string[];
	one?: Record<string, DefinedReactShape>;
	many?: Record<string, DefinedReactShape>;
};

export type DefinedReactShape = Readonly<ReactShapeSpec> & {
	readonly id: string;
};

type ShapeMetaComponent<P = object> = ComponentType<P> & {
	[SHAPE_META]?: DefinedReactShape;
};

export const defineShape = (shape: ReactShapeSpec): DefinedReactShape => {
	const normalized: DefinedReactShape = Object.freeze({
		attrs: Object.freeze([...(shape.attrs ?? [])]),
		rels: Object.freeze([...(shape.rels ?? [])]),
		one: Object.freeze({ ...(shape.one ?? {}) }),
		many: Object.freeze({ ...(shape.many ?? {}) }),
		id: `shape-${nextShapeId++}`,
	});

	return normalized;
};

export const shapeOf = <P, T extends ComponentType<P>>(
	component: T,
	shape: DefinedReactShape,
) => {
	Object.defineProperty(component, SHAPE_META, {
		value: shape,
		configurable: true,
	});

	const WrappedComponent = (props: ComponentProps<T>) =>
		createElement(MountedShape, {
			shape,
			children: createElement(
				component as ComponentType<ComponentProps<T>>,
				props,
			),
		});

	WrappedComponent.displayName =
		component.displayName || component.name || "ShapedComponent";

	Object.defineProperty(WrappedComponent, SHAPE_META, {
		value: shape,
		configurable: true,
	});

	return WrappedComponent as unknown as T;
};

export const getShapeOf = <P>(component: ComponentType<P>) =>
	(component as ShapeMetaComponent<P>)[SHAPE_META] ?? null;
