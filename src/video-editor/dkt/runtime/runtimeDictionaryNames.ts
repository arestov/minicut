export const MINICUT_RUNTIME_DICTIONARY_NAMES = Object.freeze([
	"$meta$time/instant/[:playShouldCompleteAt]",
	"$meta$apis$time$used",
	"$meta$apis$exportRuntime$used",
	"$meta$apis$importRuntime$used",
	"$meta$apis$mediaRecoveryRuntime$used",
	"$meta$apis$playbackRuntime$used",
]);

export const prepareMiniCutRuntimeDictionary = (storage: unknown): void => {
	const prepareDictionaryNames = (
		storage as {
			prepareDictionaryNames?: (names: readonly string[]) => unknown;
		} | null
	)?.prepareDictionaryNames;
	prepareDictionaryNames?.(MINICUT_RUNTIME_DICTIONARY_NAMES);
};
