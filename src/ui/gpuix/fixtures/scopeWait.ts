import { createEffect, createRoot } from "solid-js";
import {
	createAttrsFor,
	createManyFor,
	createOneFor,
} from "../../../dkt-solid-sync";
import type { ReactScopeRuntime } from "../../../dkt-ui-sync/runtime/ReactScopeRuntime";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";

/**
 * Resolves with the first value that satisfies the predicate. Reads go
 * through the dkt-solid-sync accessors (the same ones components use) inside a
 * short-lived reactive root, so scenario scripts and tests never touch the
 * scope runtime's read methods directly. The root is disposed once resolved.
 */
const waitUntil = <T>(
	open: () => () => T,
	accept: (value: T) => boolean,
): Promise<T> =>
	new Promise<T>((resolve) => {
		createRoot((dispose) => {
			const read = open();
			let settled = false;
			createEffect(() => {
				const value = read();
				if (settled || !accept(value)) return;
				settled = true;
				resolve(value);
				dispose();
			});
		});
	});

export const waitForAttr = (
	runtime: ReactScopeRuntime,
	scope: ReactSyncScopeHandle,
	attr: string,
	accept: (value: unknown) => boolean,
): Promise<unknown> =>
	waitUntil(
		() => createAttrsFor(runtime, () => scope, [attr])[attr],
		accept,
	);

export const waitForOne = (
	runtime: ReactScopeRuntime,
	scope: ReactSyncScopeHandle,
	rel: string,
	accept: (target: ReactSyncScopeHandle | null) => boolean,
): Promise<ReactSyncScopeHandle | null> =>
	waitUntil(() => createOneFor(runtime, () => scope, rel), accept);

export const waitForMany = (
	runtime: ReactScopeRuntime,
	scope: ReactSyncScopeHandle,
	rel: string,
	acceptCount: (count: number) => boolean,
): Promise<readonly ReactSyncScopeHandle[]> =>
	waitUntil(
		() => createManyFor(runtime, () => scope, rel),
		(members) => acceptCount(members.length),
	);
