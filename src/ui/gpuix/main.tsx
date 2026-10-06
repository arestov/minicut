import { render } from "@gpuix/solid";
import { RootScope } from "../../dkt-solid-sync";
import { createInProcessDkt } from "./host/createInProcessDkt";
import { AppShell } from "./AppShell";

const dkt = createInProcessDkt();

render(
	() => (
		<RootScope runtime={dkt.pageRuntime}>
			<AppShell />
		</RootScope>
	),
	{
		title: "MiniCut GPUIX (fixtures)",
		width: 1280,
		height: 800,
	},
);
