import type { DktTestContext } from "../testingInit";

export const waitForRuntimeIdle = (ctx: DktTestContext): Promise<void> =>
	ctx.computed();
