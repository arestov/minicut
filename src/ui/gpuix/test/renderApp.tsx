import type { JSX } from "solid-js";
import { createTestRoot } from "@gpuix/solid/testing";
import { RootScope } from "../../../dkt-solid-sync";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { createScenarioDriver } from "../fixtures/scenarioDriver";
import { waitForAttr, waitForOne } from "../fixtures/scopeWait";
import {
	seedScenario,
	type ScenarioName,
	type ScenarioOptions,
} from "../fixtures/scenarios";
import { createInProcessDkt } from "../host/createInProcessDkt";

/**
 * Renders a component tree on the headless TestRenderer, inside RootScope of
 * the real DKT runtime (memory storage, in-process) seeded with a scenario.
 * Sync updates reach the page asynchronously, so tests wait on runtime
 * subscriptions (`untilAttr`) and then `settle()` before asserting on text.
 */
export const renderWithScenario = async (
	scenario: ScenarioName,
	code: () => JSX.Element,
	options: ScenarioOptions = {},
) => {
	const dkt = createInProcessDkt();
	const driver = createScenarioDriver(dkt.pageRuntime);
	await seedScenario(scenario, driver, options);
	driver.destroy();

	const root = createTestRoot();
	root.render(() => (
		<div>
			<RootScope runtime={dkt.pageRuntime}>{code()}</RootScope>
		</div>
	));

	const rootScope = dkt.pageRuntime.getRootScope() as ReactSyncScopeHandle;

	return {
		runtime: dkt.pageRuntime,
		rootScope,
		root,
		renderer: root.renderer,
		texts: () => root.renderer.getAllText(),
		/** Applies pending native mutations after runtime-driven updates. */
		settle: () => root.flushSync(() => {}),
		/** Resolves once the scope attr satisfies the predicate. */
		untilAttr: (
			scope: ReactSyncScopeHandle,
			attr: string,
			predicate: (value: unknown) => boolean,
		) => waitForAttr(dkt.pageRuntime, scope, attr, predicate),
		/** Resolves once the one-rel target satisfies the predicate. */
		untilOne: (
			scope: ReactSyncScopeHandle,
			rel: string,
			predicate: (target: ReactSyncScopeHandle | null) => boolean,
		) => waitForOne(dkt.pageRuntime, scope, rel, predicate),
		/** Clicks the center of the element with the test id, through native hit testing. */
		click: (testId: string) => {
			const element = root.renderer.findByTestId(testId);
			if (!element) throw new Error(`No element with testId "${testId}"`);
			const bounds = root.renderer.getElementBounds(element.id);
			if (!bounds) throw new Error(`Element "${testId}" has no bounds`);
			root.renderer.nativeSimulateClick(
				bounds.x + bounds.width / 2,
				bounds.y + bounds.height / 2,
			);
		},
		destroy() {
			root.unmount();
			dkt.destroy();
		},
	};
};
