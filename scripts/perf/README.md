# Perf scripts

`bench-add-clip.ts` seeds N clips through the real `addClip` action on the in-process
MiniCut DKT runtime (memory storage) and prints total/per-add time per N.

```
TSX_TSCONFIG_PATH=tsconfig.video-editor.json node --conditions=browser --import tsx \
  scripts/perf/bench-add-clip.ts --n=50,100,200,400 --crdt=on|off --sync=on|off [--out=r.json]
```

- `--conditions=browser` is required (solid-js effects drive the scenario driver).
- `--crdt=off` runs without the CRDT engine; `--sync=off` drops sync messages before the page receiver.
- Add `--cpu-prof --cpu-prof-dir=<dir>` to profile.
- Each add waits for `waitForRuntimeSettled`, because `dispatchAndWait` resolves on "accepted", not on completion.
- Timings are noisy on a loaded machine; compare ratios between N, not absolute ms.
