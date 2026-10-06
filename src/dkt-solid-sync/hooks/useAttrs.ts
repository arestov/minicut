import {
	type Accessor,
	batch,
	createRenderEffect,
	createSignal,
	onCleanup,
	untrack,
} from "solid-js";
import { getAttrsShape } from "../../dkt-ui-sync/shape/autoShapes";
import type { ReactScopeRuntime } from "../../dkt-ui-sync/runtime/ReactScopeRuntime";
import { useScope, useScopeRuntime } from "../context/SolidScopeRuntimeContext";
import type { ScopeAccessor } from "../context/SolidScopeRuntimeContext";
import { mountShapeFor } from "./useShape";

export type AttrAccessors<F extends readonly string[]> = {
	readonly [K in F[number]]: Accessor<unknown>;
};

const normalizeFields = (fields: readonly string[]) =>
	Array.from(new Set(fields)).sort();

/**
 * One signal per requested attr name. A single runtime subscription for the
 * requested attrs only; it is replaced when the scope changes and dropped in
 * `onCleanup`. Unchanged values do not notify their signal.
 *
 * `fields` is a static contract: it is read once when the hook is created.
 * To follow a changing field list, recreate the owner (e.g. a keyed `Show`).
 */
export const createAttrsFor = <const F extends readonly string[]>(
	runtime: ReactScopeRuntime,
	scope: ScopeAccessor,
	fields: F,
): AttrAccessors<F> => {
	const names = normalizeFields(fields);
	const setters = new Map<string, (value: unknown) => void>();
	const accessors: Record<string, Accessor<unknown>> = {};

	const initialScope = untrack(scope);
	const initial = initialScope ? runtime.readAttrs(initialScope, names) : {};

	for (const name of names) {
		const [value, setValue] = createSignal<unknown>(initial[name]);
		accessors[name] = value;
		setters.set(name, setValue);
	}

	mountShapeFor(runtime, scope, getAttrsShape(names));

	createRenderEffect(() => {
		const currentScope = scope();

		const sync = () => {
			const snapshot = currentScope
				? runtime.readAttrs(currentScope, names)
				: {};

			batch(() => {
				for (const [name, setValue] of setters) {
					setValue(snapshot[name]);
				}
			});
		};

		if (currentScope) {
			onCleanup(runtime.subscribeAttrs(currentScope, names, sync));
		}

		sync();
	});

	return accessors as AttrAccessors<F>;
};

export const useAttrs = <const F extends readonly string[]>(
	fields: F,
): AttrAccessors<F> => createAttrsFor(useScopeRuntime(), useScope(), fields);
