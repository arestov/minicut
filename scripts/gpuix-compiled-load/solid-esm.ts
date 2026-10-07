// Compiled-load probe: ESM import of @gpuix/solid (122 bundled modules). The
// native binding is not loaded until a renderer is created. No window is opened.
import * as solid from "@gpuix/solid";

console.log(
	JSON.stringify({
		probe: "solid-esm",
		bun: process.versions.bun,
		exportCount: Object.keys(solid).length,
	}),
);
