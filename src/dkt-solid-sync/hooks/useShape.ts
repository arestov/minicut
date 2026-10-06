import { type Accessor, createRenderEffect, onCleanup } from "solid-js";
import { useScope, useScopeRuntime } from "../context/SolidScopeRuntimeContext";
import type { ScopeAccessor } from "../context/SolidScopeRuntimeContext";
import type { DefinedReactShape } from "../../dkt-ui-sync/shape/defineShape";
import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";

/**
 * Registers shape demand for the scope on creation (render phase, before
 * children read data) and releases it in `onCleanup`: when the scope changes
 * when the shape changes (pass an accessor for a reactive shape) and when
 * the owner is disposed.
 */
export const mountShapeFor = (
	runtime: ReactScopeRuntime,
	scope: ScopeAccessor,
	shape: DefinedReactShape | Accessor<DefinedReactShape>,
) => {
	createRenderEffect(() => {
		const currentScope = scope();
		const currentShape = typeof shape === "function" ? shape() : shape;

		if (!currentScope) {
			return;
		}

		onCleanup(runtime.mountShape(currentScope, currentShape));
	});
};

export const useShape = (shape: DefinedReactShape) => {
	mountShapeFor(useScopeRuntime(), useScope(), shape);
};
