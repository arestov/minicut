# DKT Structure Graph Viewer

Standalone Svelte/Svelte Flow graph viewer for the JSON snapshots produced by
`npm run structure:snapshot`.

This viewer intentionally lives outside the main Linkkraft package so `xyflow`
and `elkjs` do not affect the app bundle or the existing pvTemplate viewer.

## Run

From this folder:

```bash
npm install
npm run dev
```

Expected snapshot source:

```bash
cd ../..
npm run structure:snapshot
```

The Vite dev server exposes:

- `/snapshot/core.json`
- `/snapshot/derived.json`

as read-only routes to `../../app-structure.snapshot`.

## Why ELK

Svelte Flow renders the interactive graph, but it does not compute graph
layout. ELK is used here for stable layered layout and orthogonal edge routing.
The custom routed edge component reads ELK bend points from `edge.data.route`.

Keep ELK local to this viewer. Do not import this package from the main app.

## Node / edge interactions

- Model cards render their `rel` list inside the node rectangle.
- Hovering or clicking a `rel` edge highlights the matching `rel` row in the
  source node.
- Long `rel` lists scroll inside the card, so node height stays stable and ELK
  layout does not need per-node resizing for this interaction.

## View Model

- The viewer lays out the full visible graph once per snapshot / layer set.
- Layout is anchored to the root model at startup and stays stable while the
  user changes focus in the UI.
- Selecting a model in the model list changes the focus view, not node
  positions.
- The canvas keeps every visible model node mounted; focus is expressed through
  edge visibility and node dimming.

## Focus Rules

- The default focus model is the snapshot root / app root.
- `Scope = selected neighborhood` uses a fixed `hop = 1` neighborhood from the
  selected model.
- Models within that hop stay fully visible.
- Models outside that hop remain on canvas but are dimmed.
- Edges outside the active focus neighborhood are dimmed much more aggressively
  and do not show labels.
- `Scope = all` disables neighborhood dimming and keeps the full graph active.

## Interaction Rules

- The model list controls the focus model used for neighborhood expansion.
- Clicking a node updates the inspector but does not recompute layout.
- Clicking a `rel` row inside a node selects the same relation group as
  clicking the corresponding `rel` edge.
- Hover is linked across the relation row, the relation edge, and the target
  node highlight.
- Clicking or hovering an edge can still reveal its relation group even if the
  source node is not the current model-list selection.

## Visibility Rules

- `hierarchy` edges are hidden by default because they often duplicate `rel`
  edges and make edge interaction ambiguous.
- Infra models and infra rels are hidden while the `infra` toggle is off.
- The model list uses the same infra filter as the canvas. If a model is hidden
  as infra, it should not appear in the list either.
- `rel` rows with `rel_shape.any === true` are hidden from the node UI.
- Infra rels are also removed from node rel lists when infra is hidden, so the
  node UI matches the actual visible graph.

## Inspector

- The inspector title tracks the currently inspected item, not only the current
  model-list selection.
- This means clicking a node or edge can change the inspector header even when
  the focus model in the model list stays the same.

## Performance Notes

- Svelte Flow v1 expects immutable `nodes` / `edges`, but transient UI state is
  intentionally kept outside those arrays.
- Hover / select state is stored separately via Svelte context
  (`hoveredRelKey`, `selectedRelKey`, active focus ids, highlighted target ids).
- This avoids rebuilding `nodes` / `edges` on every pointer movement.
- Graph arrays should only be rebuilt for structural changes such as snapshot
  changes, layer toggles, infra visibility changes, or measured-layout passes.

## Known Limitations

- The current neighborhood focus depth is fixed at `hop = 1`.
- Full-graph layout keeps positions stable, but dense snapshots can still be
  visually crowded.
- ELK remains the heaviest bundle chunk in production builds.
