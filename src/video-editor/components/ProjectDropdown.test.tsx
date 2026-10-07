import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopeContext } from "../../dkt-react-sync/context/ScopeContext";
import type { ReactSyncScopeHandle } from "../../dkt-ui-sync/scope/ScopeHandle";

const useAttrsMock = vi.fn();
const useManyMock = vi.fn();
const useVideoEditorMock = vi.fn();

vi.mock("../../dkt-react-sync/components/One", () => ({
	One: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../dkt-react-sync/hooks/useAttrs", () => ({
	useAttrs: (...args: unknown[]) => useAttrsMock(...args),
}));
vi.mock("../../dkt-react-sync/hooks/useMany", () => ({
	useMany: (...args: unknown[]) => useManyMock(...args),
}));
vi.mock("../app/VideoEditorContext", () => ({
	useVideoEditor: (...args: unknown[]) => useVideoEditorMock(...args),
}));

import { ProjectDropdown } from "./ProjectDropdown";

const scope = (nodeId: string) => ({ _nodeId: nodeId }) as ReactSyncScopeHandle;

describe("ProjectDropdown active highlight", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useVideoEditorMock.mockReturnValue({
			actions: { createProject: vi.fn(), setActiveProject: vi.fn() },
		});
		useManyMock.mockImplementation((rel: string) =>
			rel === "project" ? [scope("project:a"), scope("project:b")] : [],
		);
	});

	it("marks only the project matching the activeProjectId comp", async () => {
		useAttrsMock.mockImplementation((fields: readonly string[]) =>
			fields.includes("activeProjectId")
				? { activeProjectId: "project:b" }
				: { title: "Project", updatedAt: 1 },
		);
		render(
			<ScopeContext.Provider value={scope("root")}>
				<ProjectDropdown />
			</ScopeContext.Provider>,
		);
		await userEvent.setup().click(screen.getByRole("button", { name: /project/i }));

		const items = screen.getAllByRole("menuitem");
		expect(items).toHaveLength(2);
		expect(items[0]?.className).toBe("");
		expect(items[1]?.className).toBe("is-active");
	});
});
