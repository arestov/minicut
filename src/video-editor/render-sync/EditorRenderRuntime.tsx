import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore, type PropsWithChildren } from 'react'
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

const areValuesEqual = (left: unknown, right: unknown): boolean => {
	if (Object.is(left, right)) {
		return true
	}
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
		return false
	}

	return JSON.stringify(left) === JSON.stringify(right)
}

const areRecordsShallowEqual = (left: Record<string, unknown> | null, right: Record<string, unknown>): boolean => {
	if (!left) {
		return false
	}

	const leftKeys = Object.keys(left)
	const rightKeys = Object.keys(right)
	return leftKeys.length === rightKeys.length
		&& rightKeys.every((key) => areValuesEqual(left[key], right[key]))
}

const areScopesEqual = (left: EditorScope | null, right: EditorScope | null): boolean =>
	left?.nodeId === right?.nodeId && left?.type === right?.type

const areScopeArraysEqual = (left: readonly EditorScope[] | null, right: readonly EditorScope[]): boolean =>
	Boolean(left)
	&& left!.length === right.length
	&& right.every((scope, index) => areScopesEqual(left![index], scope))

const areCompValuesEqual = (left: unknown, right: unknown): boolean => {
	if (Object.is(left, right)) {
		return true
	}
	if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
		return false
	}

	return areRecordsShallowEqual(left as Record<string, unknown>, right as Record<string, unknown>)
}

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
	const snapshotRef = useRef<Value | null>(null)
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeAttrs(resolvedScope, normalizedFields, listener),
		[runtime, resolvedScope, normalizedFields],
	)
	const getSnapshot = useCallback(
		() => {
			const nextSnapshot = runtime.readAttrs(resolvedScope, normalizedFields) as Value
			if (areRecordsShallowEqual(snapshotRef.current, nextSnapshot)) {
				return snapshotRef.current as Value
			}

			snapshotRef.current = nextSnapshot
			return nextSnapshot
		},
		[runtime, resolvedScope, normalizedFields],
	)

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useEditorOne = (relName: string, scope?: EditorScope | null): EditorScope | null => {
	const runtime = useEditorRenderRuntime()
	const resolvedScope = useResolvedScope(scope)
	const snapshotRef = useRef<EditorScope | null>(null)
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeOne(resolvedScope, relName, listener),
		[runtime, resolvedScope, relName],
	)
	const getSnapshot = useCallback(
		() => {
			const nextSnapshot = runtime.readOne(resolvedScope, relName)
			if (areScopesEqual(snapshotRef.current, nextSnapshot)) {
				return snapshotRef.current
			}

			snapshotRef.current = nextSnapshot
			return nextSnapshot
		},
		[runtime, resolvedScope, relName],
	)

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useEditorMany = (relName: string, scope?: EditorScope | null): EditorScope[] => {
	const runtime = useEditorRenderRuntime()
	const resolvedScope = useResolvedScope(scope)
	const snapshotRef = useRef<EditorScope[] | null>(null)
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeMany(resolvedScope, relName, listener),
		[runtime, resolvedScope, relName],
	)
	const getSnapshot = useCallback(
		() => {
			const nextSnapshot = runtime.readMany(resolvedScope, relName)
			if (areScopeArraysEqual(snapshotRef.current, nextSnapshot)) {
				return snapshotRef.current as EditorScope[]
			}

			snapshotRef.current = nextSnapshot
			return nextSnapshot
		},
		[runtime, resolvedScope, relName],
	)

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export const useEditorComp = <Value,>(compName: string, scope?: EditorScope | null): Value => {
	const runtime = useEditorRenderRuntime()
	const resolvedScope = useResolvedScope(scope)
	const snapshotRef = useRef<Value | null>(null)
	const subscribe = useCallback(
		(listener: () => void) => runtime.subscribeComp(resolvedScope, compName, listener),
		[runtime, resolvedScope, compName],
	)
	const getSnapshot = useCallback(
		() => {
			const nextSnapshot = runtime.readComp(resolvedScope, compName) as Value
			if (areCompValuesEqual(snapshotRef.current, nextSnapshot)) {
				return snapshotRef.current as Value
			}

			snapshotRef.current = nextSnapshot
			return nextSnapshot
		},
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
