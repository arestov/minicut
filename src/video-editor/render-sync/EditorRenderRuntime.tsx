import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react'
import { ROOT_SCOPE, type EditorScope } from './EditorScope'
import { useVideoEditor } from '../app/VideoEditorContext'

export type EditorScopedDispatch = (actionName: string, payload?: unknown) => void

export interface EditorRenderRuntime {
	getRootScope(): EditorScope
	getSessionScope(): EditorScope
	readAttrs(scope: EditorScope, fields: readonly string[]): Record<string, unknown>
	subscribeAttrs(scope: EditorScope, fields: readonly string[], listener: () => void): () => void
	readOne(scope: EditorScope, relName: string): EditorScope | null
	subscribeOne(scope: EditorScope, relName: string, listener: () => void): () => void
	readMany(scope: EditorScope, relName: string): EditorScope[]
	subscribeMany(scope: EditorScope, relName: string, listener: () => void): () => void
	readComp(scope: EditorScope, compName: string): unknown
	subscribeComp(scope: EditorScope, compName: string, listener: () => void): () => void
	getDispatch(scope?: EditorScope | null): EditorScopedDispatch
}

const EditorScopeContext = createContext<EditorScope | null>(null)

const normalizeFields = (fields: readonly string[]): readonly string[] =>
	Object.freeze(Array.from(new Set(fields)).sort())

export const EditorScopeProvider = ({ scope, children }: PropsWithChildren<{ scope: EditorScope }>) => (
	<EditorScopeContext.Provider value={scope}>{children}</EditorScopeContext.Provider>
)

export const useEditorScope = (): EditorScope | null => useContext(EditorScopeContext)

export const useEditorRenderRuntime = (): EditorRenderRuntime => useVideoEditor().renderRuntime

const useResolvedScope = (scope?: EditorScope | null): EditorScope => {
	const runtime = useEditorRenderRuntime()
	const contextScope = useEditorScope()

	return scope ?? contextScope ?? runtime.getRootScope()
}

export const useEditorAttrs = <Value extends Record<string, unknown> = Record<string, unknown>>(
	fields: readonly string[],
	scope?: EditorScope | null,
): Value => {
	const runtime = useEditorRenderRuntime()
	const resolvedScope = useResolvedScope(scope)
	const fieldsKey = fields.join('\u001f')
	const normalizedFields = useMemo(() => normalizeFields(fields), [fieldsKey])
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeAttrs(resolvedScope, normalizedFields, listener),
		[runtime, resolvedScope, normalizedFields],
	)
	const getSnapshot = useCallback(
		() => runtime.readAttrs(resolvedScope, normalizedFields) as Value,
		[runtime, resolvedScope, normalizedFields],
	)

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useEditorOne = (relName: string, scope?: EditorScope | null): EditorScope | null => {
	const runtime = useEditorRenderRuntime()
	const resolvedScope = useResolvedScope(scope)
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeOne(resolvedScope, relName, listener),
		[runtime, resolvedScope, relName],
	)
	const getSnapshot = useCallback(
		() => runtime.readOne(resolvedScope, relName),
		[runtime, resolvedScope, relName],
	)

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useEditorMany = (relName: string, scope?: EditorScope | null): EditorScope[] => {
	const runtime = useEditorRenderRuntime()
	const resolvedScope = useResolvedScope(scope)
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeMany(resolvedScope, relName, listener),
		[runtime, resolvedScope, relName],
	)
	const getSnapshot = useCallback(
		() => runtime.readMany(resolvedScope, relName),
		[runtime, resolvedScope, relName],
	)

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useEditorComp = <Value,>(compName: string, scope?: EditorScope | null): Value => {
	const runtime = useEditorRenderRuntime()
	const resolvedScope = useResolvedScope(scope)
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeComp(resolvedScope, compName, listener),
		[runtime, resolvedScope, compName],
	)
	const getSnapshot = useCallback(
		() => runtime.readComp(resolvedScope, compName) as Value,
		[runtime, resolvedScope, compName],
	)

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useEditorActions = (scope?: EditorScope | null): EditorScopedDispatch => {
	const runtime = useEditorRenderRuntime()
	const contextScope = useEditorScope()
	const resolvedScope = scope ?? contextScope ?? ROOT_SCOPE

	return useMemo(() => runtime.getDispatch(resolvedScope), [runtime, resolvedScope])
}
