import { describe, expect, it, vi } from "vitest";
import { sanitizeDktCrdtStoragePackage } from "./sanitizeStoragePackage";

describe("sanitizeDktCrdtStoragePackage", () => {
	it("rejects non structured-cloneable DKT attr values with storage context", () => {
		const updateModelAttrs = vi.fn();
		const storagePackage = sanitizeDktCrdtStoragePackage({
			dktStorage: { updateModelAttrs },
			crdtStorage: {},
		});

		expect(() =>
			(
				storagePackage.dktStorage as {
					updateModelAttrs: (id: string, changesList: unknown[]) => void;
				}
			).updateModelAttrs("resource:1", [
				"data",
				new WeakMap<object, unknown>(),
			]),
		).toThrow(/dkt\.updateModelAttrs:resource:1/);
		expect(updateModelAttrs).not.toHaveBeenCalled();
	});

	it("keeps cloneable DKT attr values and strips functions", () => {
		const updateModelAttrs = vi.fn();
		const storagePackage = sanitizeDktCrdtStoragePackage({
			dktStorage: { updateModelAttrs },
			crdtStorage: {},
		});

		(
			storagePackage.dktStorage as {
				updateModelAttrs: (id: string, changesList: unknown[]) => void;
			}
		).updateModelAttrs("resource:1", [
			"data",
			{ status: "ready", callback: () => null },
		]);

		expect(updateModelAttrs).toHaveBeenCalledWith("resource:1", [
			"data",
			{ status: "ready" },
		]);
	});

	it("preserves the callback-first commitChanges request contract", () => {
		const commitChanges = vi.fn();
		const storagePackage = sanitizeDktCrdtStoragePackage({
			dktStorage: { commitChanges },
			crdtStorage: {},
		});
		const done = vi.fn();

		(
			storagePackage.dktStorage as {
				commitChanges: (done: typeof done, meta: unknown) => void;
			}
		).commitChanges(done, { reason: "test", callback: () => null });

		expect(commitChanges).toHaveBeenCalledWith(done, { reason: "test" });
	});
});
