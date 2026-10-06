import { render } from "@gpuix/solid";
import { RootScope } from "../../dkt-solid-sync";
import { AppShell } from "./AppShell";
import { createScenarioDriver } from "./fixtures/scenarioDriver";
import { resolveScenarioSelection, seedScenario } from "./fixtures/scenarios";
import { createInProcessDkt } from "./host/createInProcessDkt";
import { Sidebar } from "./panels/Sidebar";

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
			<AppShell sidebar={<Sidebar />} />
		</RootScope>
	),
	{
		title: `MiniCut GPUIX (fixture: ${selection.name})`,
		width: 1280,
		height: 800,
	},
);
