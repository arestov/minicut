import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import type { PageSyncRuntime } from "../../../dkt-ui-sync/runtime/PageSyncRuntime";
import type { ReactSyncScopeHandle } from "../../../dkt-ui-sync/scope/ScopeHandle";
import { defineShape } from "../../../dkt-ui-sync/shape/defineShape";
import { createMiniCutPageSyncRuntime } from "../../dkt/runtime/createMiniCutPageSyncRuntime";
import { createEffectContractFakes } from "../../dkt/test/effectContractFakes";
import { createInProcessTransportPair } from "../../hosts/desktop/inProcessTransport";
import { startNodeMiniCutHost, type NodeMiniCutHost } from "./startNodeMiniCutHost";

const shape = defineShape({
  attrs: ["storageOpenStatus", "timelineZoom"],
  one: {
    activeProject: defineShape({
      attrs: ["title"],
      many: {
        tracks: defineShape({
          attrs: ["kind", "name"],
          many: {
            clips: defineShape({
              attrs: ["name", "mediaKind", "start", "in", "duration"],
              one: { text: defineShape({ attrs: ["content"] }) },
              many: { effects: defineShape({ attrs: ["kind", "name", "enabled"] }) },
            }),
          },
        }),
      },
    }),
    pioneer: defineShape({
      many: { project: defineShape({ attrs: ["title"] }) },
      one: { lastActiveProject: defineShape({ attrs: ["title"] }) },
    }),
  },
});

type Scope = ReactSyncScopeHandle;
const clipFields = ["name", "mediaKind", "start", "in", "duration"] as const;
const effectFields = ["kind", "name", "enabled"] as const;
const expectedClip = (start: number, offset: number, duration: number) => ({
  name: "Single mode caption", mediaKind: "text", start, in: offset, duration,
});

test("restores the public single-mode text graph after a clean LevelDB restart", async () => {
  const tmp = path.resolve(process.cwd(), "tmp");
  const fixture = await mkdtemp(path.join(tmp, "r288-text-restore-"));
  const profileDir = path.join(fixture, "profile");
  let host: NodeMiniCutHost | undefined;
  let runtime: PageSyncRuntime | undefined;
  let connection: ReturnType<NodeMiniCutHost["runtime"]["connect"]> | undefined;
  let unmount: (() => void) | undefined;
  const observations = new Set<() => void>();
  let connectionsClosed = true;

  const close = async () => {
    for (const stop of observations) stop();
    observations.clear();
    unmount?.();
    unmount = undefined;
    runtime?.destroy();
    runtime = undefined;
    connection?.destroy();
    connection = undefined;
    if (host) {
      await host.dispose();
      host = undefined;
    }
    connectionsClosed = true;
  };

  const observe = <T>(
    read: () => T,
    subscribeValue: (check: () => void) => () => void,
    accept: (value: T) => boolean,
  ): Promise<T> => new Promise((resolve, reject) => {
    const page = runtime!;
    let completed = false;
    const stops: Array<() => void> = [];
    const cleanup = () => {
      for (const stop of stops.splice(0)) stop();
      observations.delete(cleanup);
    };
    const attach = (stop: () => void) => {
      if (completed) stop();
      else stops.push(stop);
    };
    const check = () => {
      if (completed) return;
      try {
        const error = page.getSnapshot().runtimeError;
        if (error) throw new Error(String(error));
        const value = read();
        if (!accept(value)) return;
        completed = true;
        cleanup();
        resolve(value);
      } catch (error) {
        completed = true;
        cleanup();
        reject(error);
      }
    };
    observations.add(cleanup);
    attach(subscribeValue(check));
    attach(page.subscribe(check));
    check();
  });

  const waitOne = (scope: Scope, rel: string) =>
    observe(() => runtime!.readOne(scope, rel),
      (check) => runtime!.subscribeOne(scope, rel, check), (value) => value !== null)
      .then((value) => value!);
  const waitMany = (scope: Scope, rel: string, count: number) =>
    observe(() => runtime!.readMany(scope, rel),
      (check) => runtime!.subscribeMany(scope, rel, check), (value) => value.length === count);
  const waitAttrs = (scope: Scope, names: readonly string[], expected: Record<string, unknown>) =>
    observe(() => runtime!.readAttrs(scope, names),
      (check) => runtime!.subscribeAttrs(scope, names, check),
      (value) => names.every((name) => Object.is(value[name], expected[name])));

  const open = async () => {
    connectionsClosed = false;
    host = await startNodeMiniCutHost({ profileDir, effectInterfaces: createEffectContractFakes().interfaces });
    const pair = createInProcessTransportPair();
    connection = host.runtime.connect(pair.runtime);
    runtime = createMiniCutPageSyncRuntime({ transport: pair.page });
    runtime.bootstrap({ sessionKey: "r283-text-window", sessionId: "r283-text-window" });
    await observe(() => runtime!.getSnapshot(), (check) => runtime!.subscribe(check),
      (snapshot) => snapshot.ready && Boolean(snapshot.rootNodeId));
    const root = await observe(() => runtime!.getRootScope(),
      (check) => runtime!.subscribeRootScope(check), (value) => value !== null);
    unmount = runtime.mountShape(root!, shape);
    return root!;
  };

  const projectAndTrack = async (root: Scope) => {
    const project = await waitOne(root, "activeProject");
    const tracks = await waitMany(project, "tracks", 2);
    for (const track of tracks) {
      await observe(() => runtime!.readAttrs(track, ["kind", "name"]),
        (check) => runtime!.subscribeAttrs(track, ["kind", "name"], check),
        (attrs) => typeof attrs.kind === "string" && typeof attrs.name === "string");
    }
    const video = tracks.filter((track) => runtime!.readAttrs(track, ["kind"]).kind === "video");
    expect(video).toHaveLength(1);
    return { project, track: video[0] };
  };

  const membership = async (root: Scope, project: Scope) => {
    const pioneer = await waitOne(root, "pioneer");
    const projects = await waitMany(pioneer, "project", 1);
    const last = await waitOne(pioneer, "lastActiveProject");
    expect(projects.map((item) => item._nodeId)).toEqual([project._nodeId]);
    expect(last._nodeId).toBe(project._nodeId);
    return { projectIds: projects.map((item) => item._nodeId), lastId: last._nodeId };
  };

  const readText = async (clip: Scope) => {
    const text = await waitOne(clip, "text");
    const attrs = await waitAttrs(text, ["content"], { content: "Text" });
    return { id: text._nodeId, attrs };
  };

  const graph = async (root: Scope, project: Scope, track: Scope) => {
    const clips = await waitMany(track, "clips", 2);
    expect(new Set(clips.map((clip) => clip._nodeId)).size).toBe(2);
    for (const clip of clips) {
      await observe(() => runtime!.readAttrs(clip, clipFields),
        (check) => runtime!.subscribeAttrs(clip, clipFields, check),
        (attrs) => clipFields.every((field) => attrs[field] !== undefined));
    }
    const sorted = [...clips].sort((a, b) =>
      Number(runtime!.readAttrs(a, ["start"]).start) - Number(runtime!.readAttrs(b, ["start"]).start));
    const result = [];
    for (const [index, clip] of sorted.entries()) {
      const attrs = runtime!.readAttrs(clip, clipFields);
      expect(attrs).toEqual(index === 0 ? expectedClip(0, 0, 1) : expectedClip(1, 1, 2));
      const text = await readText(clip);
      const effects = await waitMany(clip, "effects", index === 0 ? 1 : 0);
      const effectRecords = [];
      for (const effect of effects) {
        const effectAttrs = await waitAttrs(effect, effectFields, { kind: "tint", name: "Tint", enabled: true });
        effectRecords.push({ id: effect._nodeId, attrs: effectAttrs });
      }
      result.push({ id: clip._nodeId, attrs, text, effects: effectRecords });
    }
    const title = await observe(() => runtime!.readAttrs(project, ["title"]),
      (check) => runtime!.subscribeAttrs(project, ["title"], check),
      (attrs) => typeof attrs.title === "string");
    return {
      projectId: project._nodeId, projectAttrs: title,
      trackId: track._nodeId, trackAttrs: runtime!.readAttrs(track, ["kind", "name"]),
      membership: await membership(root, project), clips: result,
    };
  };

  try {
    const root = await open();
    const identity = { ...host!.identity };
    const { project, track } = await projectAndTrack(root);
    await membership(root, project);
    await waitMany(track, "clips", 0);
    console.info("[r288] initial complete");

    await runtime!.dispatchAndWait("addTextClipToTimeline", {
      name: "Text", mediaKind: "text", start: 0, in: 0, duration: 3, text: { content: "Text" },
    }, root);
    const [clip] = await waitMany(track, "clips", 1);
    await waitAttrs(clip, clipFields, { name: "Text", mediaKind: "text", start: 0, in: 0, duration: 3 });
    await readText(clip);
    await runtime!.dispatchAndWait("rename", "Single mode caption", clip);
    await waitAttrs(clip, ["name"], { name: "Single mode caption" });
    await runtime!.dispatchAndWait("selectEntity", clip._nodeId, root);
    await runtime!.dispatchAndWait("commitSeek", 1, root);
    await runtime!.dispatchAndWait("splitSelectedClip", undefined, root);
    const split = await waitMany(track, "clips", 2);
    expect(new Set(split.map((item) => item._nodeId)).size).toBe(2);
    for (const item of split) {
      await observe(() => runtime!.readAttrs(item, clipFields),
        (check) => runtime!.subscribeAttrs(item, clipFields, check),
        (attrs) => clipFields.every((field) => attrs[field] !== undefined));
    }
    const left = split.find((item) => runtime!.readAttrs(item, ["start"]).start === 0);
    expect(left).toBeDefined();
    for (const item of split) {
      const attrs = runtime!.readAttrs(item, clipFields);
      expect(attrs).toEqual(item === left ? expectedClip(0, 0, 1) : expectedClip(1, 1, 2));
      await readText(item);
    }
    await runtime!.dispatchAndWait("addEffect", { kind: "tint" }, left!);
    const before = await graph(root, project, track);
    console.info("[r288] actions complete", JSON.stringify(before));
    await close();
    console.info("[r288] dispose complete");

    const reopenedRoot = await open();
    expect(host!.identity).toEqual({ ...identity, created: false });
    const reopened = await projectAndTrack(reopenedRoot);
    console.info("[r288] reopen complete");
    const after = await graph(reopenedRoot, reopened.project, reopened.track);
    expect(after).toEqual(before);
    console.info("[r288] oracle complete", JSON.stringify(after));
  } finally {
    await close();
    if (!connectionsClosed) throw new Error("Fixture connections are not closed");
    const resolved = path.resolve(fixture);
    if (path.dirname(resolved) !== tmp || !path.basename(resolved).startsWith("r288-text-restore-")) {
      throw new Error("Unsafe fixture cleanup path");
    }
    for (let current = resolved; ; current = path.dirname(current)) {
      const stat = await lstat(current);
      const canonical = await realpath(current);
      // Bun can return a drive-only spelling for a Windows volume root.
      const canonicalPath = current === path.dirname(current) && /^[A-Za-z]:$/.test(canonical)
        ? `${canonical}${path.sep}`
        : canonical;
      if (!stat.isDirectory() || stat.isSymbolicLink() ||
          !path.isAbsolute(canonicalPath) ||
          path.resolve(canonicalPath).toLowerCase() !== current.toLowerCase()) {
        throw new Error("Unsafe fixture cleanup ancestor: " + current);
      }
      if (current === path.dirname(current)) break;
    }
    await rm(resolved, { recursive: true });
  }
});
