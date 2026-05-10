import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { One } from "../components/One";
import { useActions } from "../hooks/useActions";
import { RootScope } from "../scope/RootScope";
import { createTestReactScopeRuntime } from "../test/createTestReactScopeRuntime";

describe("useActions", () => {
	it("dispatches actions to the current scope", () => {
		const runtime = createTestReactScopeRuntime({
			relsByNodeId: {
				root: { activeProject: "project" },
			},
		});

		const RenameButton = () => {
			const dispatch = useActions();
			return (
				<button
					type="button"
					onClick={() => dispatch("renameProject", { title: "Project B" })}
				>
					Rename
				</button>
			);
		};

		render(
			<RootScope runtime={runtime}>
				<One rel="activeProject">
					<RenameButton />
				</One>
			</RootScope>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rename" }));

		expect(runtime.dispatchCalls).toEqual([
			{
				actionName: "renameProject",
				payload: { title: "Project B" },
				scopeNodeId: "project",
			},
		]);
	});

	it("returns the same dispatch function while the scope is unchanged", () => {
		const runtime = createTestReactScopeRuntime({
			relsByNodeId: {
				root: { activeProject: "project" },
			},
		});
		const dispatches: Array<ReturnType<typeof useActions>> = [];

		const Probe = () => {
			dispatches.push(useActions());
			return <span>Ready</span>;
		};

		const { rerender } = render(
			<RootScope runtime={runtime}>
				<One rel="activeProject">
					<Probe />
				</One>
			</RootScope>,
		);

		rerender(
			<RootScope runtime={runtime}>
				<One rel="activeProject">
					<Probe />
				</One>
			</RootScope>,
		);

		expect(screen.getByText("Ready")).toBeInTheDocument();
		expect(dispatches).toHaveLength(2);
		expect(dispatches[1]).toBe(dispatches[0]);
	});
});
