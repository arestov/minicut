#!/bin/sh
# SPIKE: streaming matrix. Output: JSON lines on stdout.
cd "$(dirname "$0")/../.."
r() { node scripts/audio-spike/stream.mjs "$@" 2>&1 | grep '^{'; }
for a in worklet scheduled script; do r $a 60 100 20; done
for a in worklet scheduled script; do r $a 20 100 20 stress; done
for t in 20 40 200; do r worklet 15 $t 10; done
for t in 20 40 200; do r scheduled 15 $t 10; done
