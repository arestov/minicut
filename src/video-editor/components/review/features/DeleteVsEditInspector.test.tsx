import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { materializeDeleteVsEditReviewItem } from "../../../dkt/review/features/deleteVsEdit";
import { deleteVsEditConflictFixture } from "../../../dkt/review/features/deleteVsEdit/fixtures";
import {
	buildDeleteVsEditArchivePayload,
	buildDeleteVsEditParkPayload,
	buildDeleteVsEditRestorePayload,
} from "../reviewActionPayloads";
import { DeleteVsEditInspector } from "./DeleteVsEditInspector";

const item = materializeDeleteVsEditReviewItem({
	conflict: deleteVsEditConflictFixture,
	projectId: "project:1",
});

describe("DeleteVsEditInspector", () => {
	it("shows deleted and edited sides and emits domain action payloads", async () => {
		const onRestoreVariant = vi.fn();
		const onParkVariant = vi.fn();
		const onPreserveDelete = vi.fn();

		render(
			<DeleteVsEditInspector
				item={item}
				onRestoreVariant={onRestoreVariant}
				onParkVariant={onParkVariant}
				onPreserveDelete={onPreserveDelete}
			/>,
		);

		expect(
			screen.getByRole("region", { name: "Deleted variant" }),
		).toHaveTextContent("clip:2");
		expect(
			screen.getByRole("region", { name: "Edited variant" }),
		).toHaveTextContent("Edited remote clip");
		expect(screen.getByText("Remote source.mov")).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("button", { name: "Restore edited variant" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Park edited on review track" }),
		);
		await userEvent.click(
			screen.getByRole("button", {
				name: "Preserve delete and archive edit",
			}),
		);

		expect(onRestoreVariant).toHaveBeenCalledWith(
			buildDeleteVsEditRestorePayload(item),
		);
		expect(onParkVariant).toHaveBeenCalledWith(
			buildDeleteVsEditParkPayload(item),
		);
		expect(onPreserveDelete).toHaveBeenCalledWith(
			buildDeleteVsEditArchivePayload(item),
		);
		expect(screen.queryByText(/accept incoming/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/keep local/i)).not.toBeInTheDocument();
	});
});
