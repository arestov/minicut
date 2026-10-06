import {
	type ComponentProps,
	type ComponentType,
	type ReactNode,
	createElement,
} from "react";
import {
	type DefinedReactShape,
	type ReactShapeSpec,
	defineShape,
} from "../../dkt-ui-sync/shape/defineShape";
import { MountedShape } from "./MountedShape";

export { defineShape };
export type { DefinedReactShape, ReactShapeSpec };

const SHAPE_META = Symbol.for("dkt.react_sync.shape");

type ShapeMetaComponent<P = object> = ComponentType<P> & {
	[SHAPE_META]?: DefinedReactShape;
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
		createElement(
			MountedShape as ComponentType<{
				shape: DefinedReactShape;
				children: ReactNode;
			}>,
			{
			shape,
			children: createElement(
				component as ComponentType<Record<string, unknown>>,
				props as Record<string, unknown>,
			),
			},
		);

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
