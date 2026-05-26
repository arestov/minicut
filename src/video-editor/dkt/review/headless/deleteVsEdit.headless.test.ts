import { describe, it } from "vitest";

describe.skip("headless delete-vs-edit review actions (blocked: natural delete/edit conflicts are recorded by CRDT core, but the materialized item/action payload does not yet provide a complete targetTrackId/restorable edited variant contract)", () => {
	it("restores the edited variant from a natural delete-vs-edit review item", () => {});
	it("parks the edited variant on an incoming review track", () => {});
	it("preserves delete and archives the incoming edit", () => {});
});