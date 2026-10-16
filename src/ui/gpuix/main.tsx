import { render } from "@gpuix/solid";
import { RootScope } from "../../dkt-solid-sync";
import { AppShell } from "./AppShell";
import { createScenarioDriver } from "./fixtures/scenarioDriver";
import { resolveScenarioSelection, seedScenario } from "./fixtures/scenarios";
import { createInProcessDkt } from "./host/createInProcessDkt";
import { Inspector } from "./inspector/Inspector";
import { Sidebar } from "./panels/Sidebar";
import { Timeline } from "./timeline/Timeline";

// Scenario: --scenario=<empty|timeline|large|unavailable-resource> [--clips=N]
// or MINICUT_GPUIX_SCENARIO / MINICUT_GPUIX_CLIPS.
const selection = resolveScenarioSelection(process.argv.slice(2), process.env);
const dkt = createInProcessDkt();

const driver = createScenarioDriver(dkt.pageRuntime);
await seedScenario(selection.name, driver, selection.options);
driver.destroy();

render(
	() => (
		<RootScope runtime={dkt.pageRuntime}>
			<AppShell
				sidebar={<Sidebar />}
				timeline={<Timeline />}
				inspector={<Inspector />}
			/>
		</RootScope>
	),
	{
		title: `MiniCut GPUIX (fixture: ${selection.name})`,
		width: 1280,
		height: 800,
		// GPUIX_BACKGROUND=1 (set by the window test scripts) opens the window without taking focus.
	// Not `show: false`: a hidden or minimized window does not paint (docs/gpuix-test-windows.md).
		focus: process.env.GPUIX_BACKGROUND !== "1",
	},
);
