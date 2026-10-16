import { createAttrsFor, createOneFor, useRootDispatch, useRootScope, useScopeRuntime } from "../../../dkt-solid-sync";
import { Button } from "../controls/Button";
import { colors } from "../theme";

/** Commands address the model's canonical selection; readiness follows delivered scopes. */
export const TimelineCommands = () => {
 const runtime = useScopeRuntime();
 const root = useRootScope();
 const project = createOneFor(runtime, root, "activeProject");
 const selected = createOneFor(runtime, root, "selectedClip");
 const attrs = createAttrsFor(runtime, root, ["$meta$rels$activeProject$exists", "$meta$rels$selectedClip$exists", "selectedEntityId", "cursor"]);
 const projectAttrs = createAttrsFor(runtime, project, ["title"]);
 const clipAttrs = createAttrsFor(runtime, selected, ["name"]);
 const dispatch = useRootDispatch();
 const projectReady = () => attrs.$meta$rels$activeProject$exists() === true && project() !== null && typeof projectAttrs.title() === "string";
 const clipReady = () => projectReady() && attrs.$meta$rels$selectedClip$exists() === true && selected() !== null && typeof clipAttrs.name() === "string" && attrs.selectedEntityId() === selected()?._nodeId;
 const splitReady = () => clipReady() && typeof attrs.cursor() === "number" && Number.isFinite(attrs.cursor());
 const target = () => attrs.$meta$rels$activeProject$exists() === false ? "No active project" : !projectReady() ? "Loading project…" : attrs.$meta$rels$selectedClip$exists() === false ? "No clip selected" : !clipReady() ? "Loading selection…" : clipAttrs.name() as string;
 return <div testId="timeline-commands" style={{ display: "flex", flexDirection: "column", flexShrink: 0, padding: 6, gap: 6 }}>
  <text testId="timeline-command-target" style={{ color: colors.textMuted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{target()}</text>
  <div style={{ display: "flex", flexDirection: "row", gap: 6 }}>
   <Button testId="timeline-split" aria-label="Split clip" disabled={!splitReady()} onClick={() => { if (splitReady()) dispatch("splitSelectedClip"); }}>Split</Button>
   <Button testId="timeline-nudge-back" aria-label="Nudge -0.5s" disabled={!clipReady()} onClick={() => { if (clipReady()) dispatch("nudgeSelectedClip", { delta: -0.5 }); }}>-0.5s</Button>
   <Button testId="timeline-nudge-forward" aria-label="Nudge +0.5s" disabled={!clipReady()} onClick={() => { if (clipReady()) dispatch("nudgeSelectedClip", { delta: 0.5 }); }}>+0.5s</Button>
   <Button testId="timeline-delete" aria-label="Delete clip" disabled={!clipReady()} onClick={() => { if (clipReady()) dispatch("deleteSelectedClip"); }}>Delete</Button>
  </div>
 </div>;
};
