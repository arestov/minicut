import { formatSeconds } from "../../../video-editor/components/format";

export const formatInspectorTime = (value: unknown): string =>
 typeof value === "number" && Number.isFinite(value) ? formatSeconds(value) : "Unavailable";
