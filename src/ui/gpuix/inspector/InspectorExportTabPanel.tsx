import { Show } from "solid-js";
import { useAttrs, useRootDispatch, useRootScope, useScope } from "../../../dkt-solid-sync";
import { formatExportProgress, isExportRunning, type ExportProgressState } from "../../../video-editor/app/exportProgressState";
import { Button } from "../controls/Button";
import { useHostServices } from "../host/hostServices";

export const InspectorExportTabPanel = (props: { isCurrentOwner: () => boolean; exportProgress: unknown }) => {
 const clipId = useScope()()?._nodeId ?? "";
 const attrs = useAttrs(["name"]);
 const root = useRootScope();
 const dispatch = useRootDispatch();
 const host = useHostServices();
 const ownProgress = (): ExportProgressState | null => {
  const value = props.exportProgress;
  if (!value || typeof value !== "object") return null;
  const progress = value as ExportProgressState;
  return progress.range?.type === "clip" && progress.range.clipId === clipId ? progress : null;
 };
 const running = () => isExportRunning(ownProgress());
 const saved = () => ownProgress()?.stage === "done" && !!ownProgress()?.fileName && !!host?.exportDirectory;
 return <div testId="inspector-export-controls" style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
  <text>Clip export</text><text>Range Clip</text><text>Format WebM</text><text>Quality High</text>
  <Button testId="inspector-export-queue" aria-label="Queue clip export" disabled={!props.isCurrentOwner() || running()} onClick={() => {
   if (!clipId || !props.isCurrentOwner() || running()) return;
   dispatch("requestSelectedClipExport", { id: `export:${crypto.randomUUID()}`, initiatedBy: root()?._nodeId ?? null });
  }}><text>{running() ? `Rendering ${formatExportProgress(ownProgress()!)}` : "Queue clip export"}</text></Button>
  <Show when={running()}><text>{`Rendering export file for ${String(attrs.name())}: ${formatExportProgress(ownProgress()!)}`}</text></Show>
  <Show when={ownProgress()?.stage === "done"}><text role="status">{`Export ready: ${ownProgress()?.frameCount ?? 0} frames · ${ownProgress()?.size ?? 0} bytes${ownProgress()?.fileName ? ` · ${ownProgress()!.fileName}` : ""}`}</text></Show>
  <Show when={saved()}><text>{`Saved file: ${ownProgress()?.fileName}`}</text><text>{`Export folder: ${host?.exportDirectory}`}</text></Show>
  <Show when={ownProgress()?.stage === "error"}><text role="status">{`Export failed: ${ownProgress()?.error ?? "Unknown error"}`}</text></Show>
 </div>;
};
