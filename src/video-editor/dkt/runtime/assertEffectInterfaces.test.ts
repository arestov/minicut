import { describe, expect, it } from "vitest";
import { assertEffectInterfacesComplete } from "../../core/bootstrap/assertEffectInterfaces";
import { createEffectContractFakes } from "../test/effectContractFakes";

describe("effect interface completeness", () => {
	it("accepts a platform without the optional media restore interface", () => {
		const { interfaces } = createEffectContractFakes();
		expect("mediaRestoreRuntime" in interfaces).toBe(false);
		expect(() => assertEffectInterfacesComplete(interfaces)).not.toThrow();
	});

	it("accepts a complete media restore interface", () => {
		const { interfaces } = createEffectContractFakes({ mediaRestore: true });
		expect(() => assertEffectInterfacesComplete(interfaces)).not.toThrow();
	});

	it("rejects a declared but unimplemented media restore interface", () => {
		const { interfaces } = createEffectContractFakes();
		expect(() =>
			assertEffectInterfacesComplete({ ...interfaces, mediaRestoreRuntime: {} }),
		).toThrow(/mediaRestoreRuntime\.restoresMediaAtBoot/);
		expect(() =>
			assertEffectInterfacesComplete({ ...interfaces, mediaRestoreRuntime: null }),
		).toThrow(/mediaRestoreRuntime/);
	});

	it("still requires the mandatory interfaces", () => {
		expect(() => assertEffectInterfacesComplete({})).toThrow(/exportRuntime/);
	});
});
