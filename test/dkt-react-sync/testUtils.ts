export const waitFor = async (predicate: () => boolean): Promise<void> => {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for React sync state");
};
