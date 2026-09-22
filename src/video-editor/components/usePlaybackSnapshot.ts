import { useSyncExternalStore } from "react";
import { useVideoEditor } from "../app/VideoEditorContext";
import type { PlaybackSnapshot } from "../playback/playbackRuntime";

export const usePlaybackSnapshot = (): PlaybackSnapshot => {
	const { playback } = useVideoEditor();
	return useSyncExternalStore(
		playback.subscribe,
		playback.getSnapshot,
		playback.getSnapshot,
	);
};
