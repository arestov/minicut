// Compiled-load probe: `require` goes through the CJS entry of @gpuix/native, which
// Bun statically bundles together with the .node binding. No window is opened.
const native = require("@gpuix/native");
console.log(
	JSON.stringify({
		probe: "native-cjs",
		bun: process.versions.bun,
		hasGpuixRenderer: typeof native.GpuixRenderer === "function",
	}),
);
