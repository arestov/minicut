import { describe, expectTypeOf, it } from "vitest";
import type {
	EditorMediaPort,
	EditorMediaRecoveryPort,
} from "./editorActionEnvironment";

describe("editor media port contracts", () => {
	it("keeps recovery capabilities optional at generic editor boundaries", () => {
		type MediaBoundary = EditorMediaPort & Partial<EditorMediaRecoveryPort>;
		expectTypeOf<Pick<MediaBoundary, "createObjectUrl">>().toMatchTypeOf<
			Pick<EditorMediaPort, "createObjectUrl">
		>();
		expectTypeOf<MediaBoundary["fingerprintFile"]>().toEqualTypeOf<
			EditorMediaRecoveryPort["fingerprintFile"] | undefined
		>();
		expectTypeOf<MediaBoundary["estimateStorage"]>().toEqualTypeOf<
			EditorMediaRecoveryPort["estimateStorage"] | undefined
		>();
	});
});
