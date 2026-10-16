import { expect, test } from "vitest";
import { bootDktModels } from "../testingInit";

// Same memory CRDT mode as the GPUIX fixture; no native renderer or page events.
// Each mutation settles independently; all assertions use subsequent public queries.
test("local CRDT trim beyond the linked source rolls back and records a conflict", async () => {
 const ctx = await bootDktModels({
  crdt: { enabled: true, peerId: "inspector-trim-isolation", storage: "memory", transport: null },
 });
 try {
  await ctx.lockToRead(() => ctx.sessionRoot.dispatch("createProject", { title: "Inspector trim isolation" }));
  const [project] = await ctx.queryRel(ctx.sessionRoot, "activeProject");
  expect(project).toBeDefined();
  await ctx.lockToRead(() => project.dispatch("importResource", {
   name: "Interview.mp4", kind: "video", url: "http://fixture.test/Interview.mp4",
   mime: "video/mp4", duration: 42, size: 4_800_000,
   source: { kind: "local", ownerPeerId: "fixture-peer" }, status: "ready",
   data: { status: "ready", chunkSize: 1024, chunks: {}, ranges: { loaded: [[0, 4_800_000]], requested: [] }, loadedBytes: 4_800_000 },
  }));
  const resources = await ctx.queryRel(project, "resources");
  expect(resources).toHaveLength(1);
  const resource = resources[0];
  expect(await ctx.queryAttr(resource, "name")).toBe("Interview.mp4");
  expect(await ctx.queryAttr(resource, "kind")).toBe("video");
  expect(await ctx.queryAttr(resource, "duration")).toBe(42);
  await ctx.lockToRead(() => project.dispatch("addResourceToTimeline", resource._node_id));
  const tracks = await ctx.queryRel(project, "tracks");
  const trackKinds = await Promise.all(tracks.map(track => ctx.queryAttr(track, "kind")));
  const videoTrack = tracks[trackKinds.indexOf("video")];
  expect(videoTrack).toBeDefined();
  const [clip] = await ctx.queryRel(videoTrack, "clips");
  expect(clip).toBeDefined();
  const [linkedResource] = await ctx.queryRel(clip, "resource");
  expect(linkedResource._node_id).toBe(resource._node_id);
  expect(await ctx.queryAttr(linkedResource, "duration")).toBe(42);
  const timing = async () => ({
   start: await ctx.queryAttr(clip, "start"),
   in: await ctx.queryAttr(clip, "in"),
   duration: await ctx.queryAttr(clip, "duration"),
  });
  const before = await timing();
  expect(before).toEqual({ start: 0, in: 0, duration: 42 });
  const conflictAttr = "$meta$aggregates$crdt$clipTiming$open_conflicts_count";
  expect(await ctx.queryAttr(clip, conflictAttr)).toBe(0);
  await ctx.lockToRead(() => clip.dispatch("trim", { edge: "end", delta: 0.5 }));
  const after = await timing();
  expect(after).toEqual(before);
  expect(await ctx.queryAttr(clip, conflictAttr)).toBe(1);
  expect((await ctx.queryRel(clip, "resource"))[0]._node_id).toBe(resource._node_id);
  expect(await ctx.queryAttr(linkedResource, "duration")).toBe(42);
 } finally {
  await ctx.close();
 }
});
