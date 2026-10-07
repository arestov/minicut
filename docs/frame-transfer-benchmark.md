# RGBA frame transfer benchmark

Date: 2026-10-07. Windows 11, Node 24.17.0, Bun 1.4.2, 16 logical CPUs. One run of
200 frames per cell (first 20 excluded as warm-up); numbers are indicative, not
statistically tight (run-to-run variance of 20-30% is normal on this machine).

Script: `scripts/bench-frame-transfer.mjs` (not part of any default test set).

```
node scripts/bench-frame-transfer.mjs --frames=200
bun  scripts/bench-frame-transfer.mjs --frames=200      # BUN_BIN if bun is not on PATH
```

## What is measured

Frames of 960x540 (2.0 MiB) and 1920x1080 (7.9 MiB) RGBA reach the main thread:

| Path | Mechanism | Copies producer -> consumer |
| --- | --- | --- |
| worker copy | `postMessage({ buf })` structured clone | 1 (clone), producer keeps its buffer |
| worker transfer | `postMessage(msg, [buf])` | 0 (buffer detached in the producer; verified by `byteLength === 0`) |
| worker SAB ring | 4-slot `SharedArrayBuffer`, `postMessage({ slot })`, consumer acks to free a slot | 0 (shared memory; needs slot ownership protocol) |
| child stdout | child writes raw frames to a pipe, parent reassembles from chunks | 2+ (child write into pipe, pipe read into chunk, chunk copied into a frame buffer) |

The producer fills each frame with a cheap pattern (fill plus one byte per 4 KiB
page). The consumer touches one byte per page. Latency = receive time minus the
producer's send timestamp (shared wall clock via `performance.timeOrigin`), so it
includes producer-side queueing under the 4-frame window. Memory columns are peak
growth of main-thread `rss` / `arrayBuffers` during the run (workers are not
counted for `arrayBuffers`; rss includes the whole process).

## Results

960x540 (2.0 MiB per frame):

| Runtime | Path | fps | MiB/s | p50 ms | p95 ms | max ms | rss peak +MB | arrayBuffers peak +MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| node | worker copy | 977 | 1932 | 1.03 | 2.19 | 3.04 | 175 | 79 |
| node | worker transfer | 2298 | 4545 | 0.04 | 0.42 | 3.96 | 83 | 0 |
| node | worker SAB ring | 3042 | 6015 | 0.02 | 0.06 | 0.12 | 14 | 0 |
| node | child stdout | 496 | 981 | 2.20 | 3.12 | 8.14 | 27 | 53 |
| bun | worker copy | 953 | 1884 | 2.08 | 3.68 | 5.77 | 69 | 12 |
| bun | worker transfer | 1830 | 3619 | 1.31 | 2.44 | 3.57 | 4 | 14 |
| bun | worker SAB ring | 11351 | 22447 | 0.02 | 0.05 | 0.08 | 4 | 0 |
| bun | child stdout | 364 | 719 | 2.63 | 4.26 | 5.26 | 0 | 0 |

1920x1080 (7.9 MiB per frame):

| Runtime | Path | fps | MiB/s | p50 ms | p95 ms | max ms | rss peak +MB | arrayBuffers peak +MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| node | worker copy | 293 | 2317 | 3.78 | 6.13 | 8.53 | 111 | 35 |
| node | worker transfer | 855 | 6760 | 0.04 | 0.29 | 0.33 | 38 | 0 |
| node | worker SAB ring | 787 | 6228 | 0.03 | 0.06 | 0.13 | 38 | 0 |
| node | child stdout | 125 | 992 | 7.10 | 13.91 | 15.80 | 0 | 52 |
| bun | worker copy | 267 | 2114 | 4.42 | 7.98 | 10.87 | 180 | 35 |
| bun | worker transfer | 927 | 7335 | 0.99 | 2.50 | 3.58 | 0 | 55 |
| bun | worker SAB ring | 3182 | 25173 | 0.03 | 0.06 | 0.09 | 6 | 0 |
| bun | child stdout | 136 | 1078 | 7.07 | 8.48 | 10.41 | 0 | 8 |

## Reading the numbers

- Every path clears a 30 fps preview at 1080p with a large margin (worst case:
  child stdout, about 125-136 fps at 1080p, about 360-500 fps at 540p). Transfer
  cost is not the bottleneck; frame production (decode, scale, color) will be.
- Structured-clone copy costs roughly 3x the throughput of a transfer and holds
  extra memory (up to 180 MB rss growth at 1080p), so copying should be avoided
  for steady-state preview but is acceptable for occasional frames.
- Transfer is the simple default: zero copies, same speed class on Node and Bun.
  The sender loses the buffer, so it needs a pool or must allocate per frame.
  Bun shows higher p50 latency for transfers (about 1 ms vs 0.04 ms on Node), the
  only clear Bun/Node difference apart from SAB; still far below a 16 ms frame.
- The SAB ring is fastest and has near-zero memory growth, but adds an ownership
  protocol (slot acks). Bun's SAB numbers (11-25 GB/s) mostly reflect a cheaper
  producer fill in that path; treat them as "not slower than Node", not as a
  speedup. The ring only matters if frames are produced in-process by a worker.
- Child process stdout is about 3-6x slower than transfer, with two extra copies,
  but still about 1 GB/s. It is the route for ffmpeg `rawvideo` pipes; the
  consumer must reassemble frames across arbitrary chunk boundaries (done here).
  Child pipe throughput under Bun was within 15% of Node (slower at 540p, faster
  at 1080p; within noise).
- No Bun correctness difference: all four paths delivered every frame, and
  transferred buffers were detached on both runtimes.

## Not verified

- Producer cost of real frames (ffmpeg decode/scale), GPU upload cost, or the GPUIX
  consumer; this measures only the transport.
- Single run per cell, no CPU pinning; Windows scheduler noise can move numbers by
  tens of percent.
