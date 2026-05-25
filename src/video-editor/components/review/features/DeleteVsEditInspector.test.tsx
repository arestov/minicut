import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { materializeDeleteVsEditReviewItem } from "../../../dkt/review/features/deleteVsEdit";
import { deleteVsEditConflictFixture } from "../../../dkt/review/features/deleteVsEdit/fixtures";
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

		const expectedPayload = {
			conflictId: "conflict:delete-vs-edit",
			reviewItemId: "review:conflict:delete-vs-edit",
			clipId: "clip:2",
			targetTrackId: "track:main",
			deletedVariant: expect.objectContaining({ clipId: "clip:2" }),
			editedVariant: expect.objectContaining({
				clipAttrs: expect.objectContaining({
					name: "Edited remote clip",
					duration: 2,
				}),
			}),
		};
		expect(onRestoreVariant).toHaveBeenCalledWith(expectedPayload);
		expect(onParkVariant).toHaveBeenCalledWith(expectedPayload);
		expect(onPreserveDelete).toHaveBeenCalledWith(expectedPayload);
		expect(screen.queryByText(/accept incoming/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/keep local/i)).not.toBeInTheDocument();
	});
});
