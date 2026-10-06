import {
	createAttrsFor,
	useRootScope,
	useScopeRuntime,
} from "../../../dkt-solid-sync";

/** Attrs of the root (session) scope, whatever scope the component renders in. */
export const useRootAttrs = <const F extends readonly string[]>(fields: F) =>
	createAttrsFor(useScopeRuntime(), useRootScope(), fields);
