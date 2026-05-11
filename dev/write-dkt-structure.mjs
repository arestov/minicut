#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'

import { exportModelStructure } from 'dkt-all/libs/provoda/structure/exportModelStructure.js'
import writeStructureSnapshot from '../tmp/dkt/dev/structure-port/src/structure.mjs'
import { MiniCutAppRoot } from '../src/video-editor/models/AppRoot.ts'

function getOptionValue(name, fallback) {
  const args = process.argv.slice(2)
  const withEqualsPrefix = `${name}=`
  const index = args.findIndex(
    (arg) => arg === name || arg.startsWith(withEqualsPrefix),
  )

  if (index === -1) {
    return fallback
  }

  const arg = args[index]
  if (arg.startsWith(withEqualsPrefix)) {
    const value = arg.slice(withEqualsPrefix.length)
    return value || fallback
  }

  const next = args[index + 1]
  if (!next || next.startsWith('-')) {
    return fallback
  }

  return next
}

function asString(value) {
  return value == null ? '' : String(value)
}

function stableStringify(value) {
  return JSON.stringify(value ?? null)
}

function sortBy(list, pickKey) {
  if (!Array.isArray(list)) {
    return []
  }

  return [...list].sort((left, right) => {
    const leftKey = pickKey(left)
    const rightKey = pickKey(right)
    return leftKey.localeCompare(rightKey)
  })
}

function sortModel(model) {
  return {
    ...model,
    attrs: sortBy(model?.attrs, (attr) =>
      [asString(attr?.name), asString(attr?.kind), stableStringify(attr?.deps)].join('|'),
    ),
    rels: sortBy(model?.rels, (rel) =>
      [
        asString(rel?.name),
        asString(rel?.kind),
        asString(rel?.many),
        asString(rel?.any),
      ].join('|'),
    ),
    actions: sortBy(model?.actions, (action) =>
      [
        asString(action?.action_name ?? action?.name),
        asString(action?.mode),
        stableStringify(action?.targets),
      ].join('|'),
    ),
  }
}

function sortSnapshotLayer(layer) {
  if (!layer || typeof layer !== 'object') {
    return layer
  }

  return {
    ...layer,
    models: sortBy(layer.models, (model) =>
      [asString(model?.hierarchy_num), asString(model?.id), asString(model?.model_name)].join('|'),
    ).map(sortModel),
    hierarchy_edges: sortBy(layer.hierarchy_edges, (edge) =>
      [asString(edge?.from), asString(edge?.to), asString(edge?.name), asString(edge?.kind)].join('|'),
    ),
    rel_edges: sortBy(layer.rel_edges, (edge) =>
      [
        asString(edge?.from),
        asString(edge?.rel_name),
        asString(edge?.kind),
        asString(edge?.generated_from),
        stableStringify(edge?.child_model_refs),
      ].join('|'),
    ),
    attr_edges: sortBy(layer.attr_edges, (edge) =>
      [
        asString(edge?.from),
        asString(edge?.attr_name),
        asString(edge?.kind),
        asString(edge?.dep_index),
        asString(edge?.dep),
      ].join('|'),
    ),
    action_edges: sortBy(layer.action_edges, (edge) =>
      [
        asString(edge?.from),
        asString(edge?.action_name),
        asString(edge?.kind),
        stableStringify(edge),
      ].join('|'),
    ),
  }
}

function sortSnapshot(snapshot) {
  return {
    ...snapshot,
    core: sortSnapshotLayer(snapshot?.core),
    derived: sortSnapshotLayer(snapshot?.derived),
  }
}

async function main() {
  const dirArg = getOptionValue('--dir', 'app-structure.snapshot')
  const dir = path.resolve(process.cwd(), dirArg)
  const snapshot = sortSnapshot(exportModelStructure(MiniCutAppRoot))
  const result = await writeStructureSnapshot(MiniCutAppRoot, { dir, snapshot })

  console.log(
    [
      '[structure-port] snapshot written',
      `dir: ${result.dir}`,
      `core.models: ${result.snapshot.core.models.length}`,
      `core.hierarchy_edges: ${result.snapshot.core.hierarchy_edges.length}`,
      `core.rel_edges: ${result.snapshot.core.rel_edges.length}`,
      `core.attr_edges: ${result.snapshot.core.attr_edges.length}`,
      `core.action_edges: ${result.snapshot.core.action_edges.length}`,
      `derived.models: ${result.snapshot.derived.models.length}`,
      `derived.rel_edges: ${result.snapshot.derived.rel_edges.length}`,
      `derived.attr_edges: ${result.snapshot.derived.attr_edges.length}`,
      `derived.action_edges: ${result.snapshot.derived.action_edges.length}`,
    ].join('\n'),
  )
}

main().catch((error) => {
  console.error('[structure-port] failed')
  console.error(error?.stack || error)
  process.exit(1)
})
