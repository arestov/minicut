import { createRuntimeTaskFacade } from "../../../video-editor/app/runtimeTaskFacade";
import type { RuntimeRefs } from "./hostTypes";

/**
 * Runtime ref store of the GPUIX host (same facade the Web page uses): values
 * such as file paths stay in this process; the graph carries only the
 * returned `runtimeHandleId`.
 */
export const createRuntimeRefStore = (): RuntimeRefs => {
	const facade = createRuntimeTaskFacade();
	return {
		put: (value) => facade.putRuntimeRef(value),
		get: (id) => facade.getRuntimeRef(id),
		consume: (id) => facade.consumeRuntimeRef(id),
		delete: (id) => facade.deleteRuntimeRef(id),
	};
};
