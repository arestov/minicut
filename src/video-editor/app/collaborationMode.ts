export const TEST_SINGLE_MODE_PARAM = "__minicut_test_single";

export type CollaborationMode = "p2p" | "single";

type ViteEnvLike = Record<string, unknown>;

const isTruthyFlag = (value: unknown): boolean => {
	if (typeof value !== "string") {
		return value === true;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
};

const isInternalRuntime = (env: ViteEnvLike): boolean =>
	env.DEV === true || env.MODE === "test";

export const resolveCollaborationMode = ({
	env,
	searchParams,
}: {
	env: ViteEnvLike;
	searchParams: URLSearchParams;
}): CollaborationMode => {
	const requestedSingleMode =
		isTruthyFlag(searchParams.get(TEST_SINGLE_MODE_PARAM)) ||
		isTruthyFlag(env.VITE_MINICUT_TEST_SINGLE_MODE);

	if (requestedSingleMode && isInternalRuntime(env)) {
		return "single";
	}

	return "p2p";
};
