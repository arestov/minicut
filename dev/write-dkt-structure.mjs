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
    actions: sortBy(
      (model?.actions || []).filter(isVisibleAction),
      (action) =>
        [
          asString(action?.action_name ?? action?.name),
          asString(action?.mode),
          stableStringify(action?.targets),
        ].join('|'),
    ),
  }
}

function isVisibleAction(action) {
  const name = asString(action?.action_name || action?.name)
  return name !== '__checkAndDisposeModel' && name !== 'checkAndDisposeModel'
}

function targetPathString(target) {
  return asString(target?.target_path?.path_string || target?.target_path?.value)
}

function actionKey(model, actionName) {
  return [asString(model?.model_name || model?.id), asString(actionName)].join('.')
}

function pathTokens(value) {
  return asString(value).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []
}

function depMentionsName(dep, name) {
  const needle = asString(name)
  if (!needle) {
    return false
  }

  return pathTokens(dep).includes(needle)
}

function findRelTargetModelName(model, relName) {
  const rel = (model?.rels || []).find((item) => item?.name === relName)
  const ref = rel?.child_model_refs?.find((item) => item?.model_name)
  return ref?.model_name || null
}

function inferTargetModelName(model, target, modelsByName = new Map()) {
  const resultName = asString(target?.result_name)
  const path = targetPathString(target)
  const tokens = pathTokens(path)
  const rootIndex = tokens.indexOf('$root')
  if (rootIndex !== -1 && tokens[rootIndex + 1]) {
    return tokens[rootIndex + 1]
  }

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (modelsByName.has(tokens[index])) {
      return tokens[index]
    }
  }

  if (modelsByName.has(resultName)) {
    return resultName
  }

  const relName = tokens[tokens.length - 1] || resultName
  return findRelTargetModelName(model, relName)
}

function classifyTarget(model, target, modelsByName = new Map()) {
  const options = target?.options || {}
  const resultName = asString(target?.result_name)
  const path = targetPathString(target)
  const targetModelName = inferTargetModelName(model, target, modelsByName)

  if (target?.path_type === 'inline_saga_output') {
    return {
      kind: 'output',
      name: resultName || '$output',
      path,
    }
  }

  if (options.action) {
    return {
      kind: 'subflow',
      name: asString(options.action),
      action: asString(options.action),
      model_name: targetModelName,
      path,
      sub_flow: options.sub_flow === true,
    }
  }

  if (options.can_create) {
    return {
      kind: 'create',
      name: resultName,
      model_name: targetModelName || resultName || null,
      path,
      method: options.method || null,
      creation_shape: options.creation_shape || null,
    }
  }

  if (target?.path_type === 'by_node_id' || path.includes('*')) {
    return {
      kind: 'wildcard',
      name: resultName || '*',
      path,
    }
  }

  if (resultName && (model?.rels || []).some((rel) => rel?.name === resultName)) {
    return {
      kind: 'rel',
      name: resultName,
      model_name: model?.model_name || null,
      path,
      method: options.method || null,
    }
  }

  return {
    kind: resultName ? 'attr' : 'target',
    name: resultName || path || 'target',
    model_name: model?.model_name || null,
    path,
    method: options.method || null,
  }
}

function flattenActionSteps(action) {
  if (Array.isArray(action?.steps) && action.steps.length) {
    return action.steps.map((step, index) => ({
      ...step,
      step_index: index,
      step_name: step?.name || `${action.action_name || action.name}#${index + 1}`,
    }))
  }

  return [{
    ...action,
    step_index: 0,
    step_name: action?.name || action?.action_name || null,
  }]
}

function collectActionEdgesFromLayer(layer, analysisLayer = layer) {
  const result = []
  const { modelsByName } = buildDerivedIndex(analysisLayer)

  for (const model of layer?.models || []) {
    for (const action of model.actions || []) {
      if (!isVisibleAction(action)) {
        continue
      }

      for (const step of flattenActionSteps(action)) {
        const targets = step.targets || []
        for (let index = 0; index < targets.length; index += 1) {
          result.push({
            from: model.id,
            model_name: model.model_name,
            action_name: action.action_name || action.name || null,
            step_name: step.step_name,
            step_index: step.step_index,
            mode: action.mode || null,
            step_mode: step.mode || null,
            target_index: index,
            target: targets[index],
            target_effect: classifyTarget(model, targets[index], modelsByName),
            generated: action.generated === true,
          })
        }
      }
    }
  }

  return result
}

function buildDerivedIndex(layer) {
  const modelsByName = new Map()
  const modelsById = new Map()

  for (const model of layer?.models || []) {
    modelsByName.set(model.model_name, model)
    modelsById.set(asString(model.id), model)
  }

  return { modelsByName, modelsById }
}

function collectDerivedAffects(analysisLayer, model, effects) {
  const { modelsByName } = buildDerivedIndex(analysisLayer)
  const affected = new Map()
  const queue = effects
    .filter((effect) => effect.kind === 'attr' || effect.kind === 'rel')
    .map((effect) => ({
      model_name: effect.model_name || model?.model_name || null,
      name: effect.name,
    }))

  for (const effect of effects) {
    if ((effect.kind === 'create' || effect.kind === 'subflow') && effect.model_name) {
      affected.set(`${effect.model_name}:model`, {
        kind: 'model',
        model_name: effect.model_name,
        reason: effect.kind,
      })
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    const currentModel = modelsByName.get(current.model_name)
    if (!currentModel || !current.name) {
      continue
    }

    for (const attr of currentModel.attrs || []) {
      if (attr.kind !== 'comp' && attr.kind !== 'generated') {
        continue
      }

      const deps = Array.isArray(attr.deps) ? attr.deps : []
      if (!deps.some((dep) => depMentionsName(dep, current.name))) {
        continue
      }

      const key = `${currentModel.model_name}:attr:${attr.name}`
      if (affected.has(key)) {
        continue
      }

      const next = {
        kind: 'attr',
        model_name: currentModel.model_name,
        name: attr.name,
        reason: current.name,
      }
      affected.set(key, next)
      queue.push(next)
    }
  }

  return Array.from(affected.values()).sort((left, right) =>
    [
      asString(left.model_name),
      asString(left.kind),
      asString(left.name),
    ].join('|').localeCompare([
      asString(right.model_name),
      asString(right.kind),
      asString(right.name),
    ].join('|')),
  )
}

function buildActionFlows(layer, analysisLayer = layer) {
  const { modelsByName } = buildDerivedIndex(analysisLayer)
  const flows = []

  for (const model of layer?.models || []) {
    for (const action of model.actions || []) {
      if (!isVisibleAction(action)) {
        continue
      }

      const steps = flattenActionSteps(action).map((step) => {
        const effects = (step.targets || []).map((target) =>
          classifyTarget(model, target, modelsByName),
        )
        return {
          name: step.step_name,
          mode: step.mode || null,
          deps: step.deps || null,
          writes: effects.filter((effect) => effect.kind !== 'subflow'),
          subflows: effects
            .filter((effect) => effect.kind === 'subflow')
            .map((effect) => ({
              ...effect,
              flow_id: effect.model_name && modelsByName.has(effect.model_name)
                ? actionKey(modelsByName.get(effect.model_name), effect.action)
                : null,
            })),
        }
      })
      const effects = steps.flatMap((step) => [...step.writes, ...step.subflows])

      flows.push({
        id: actionKey(model, action.action_name || action.name),
        model_id: model.id,
        model_name: model.model_name,
        action_name: action.action_name || action.name || null,
        mode: action.mode || null,
        generated: action.generated === true,
        source_group: action.source_group || null,
        deps: action.deps || null,
        steps,
        derived_affects: collectDerivedAffects(analysisLayer, model, effects),
        raw: action,
      })
    }
  }

  const flowsById = new Map(flows.map((flow) => [flow.id, flow]))
  const expandFlow = (flow, visited = new Set()) => {
    if (!flow || visited.has(flow.id)) {
      return {
        derived_affects: [],
        transitive_subflows: [],
      }
    }

    visited.add(flow.id)
    const derivedByKey = new Map(
      (flow.derived_affects || []).map((item) => [
        [asString(item.model_name), asString(item.kind), asString(item.name)].join('|'),
        item,
      ]),
    )
    const transitiveSubflows = new Map()

    for (const step of flow.steps || []) {
      for (const subflow of step.subflows || []) {
        if (!subflow.flow_id) {
          continue
        }

        transitiveSubflows.set(subflow.flow_id, {
          id: subflow.flow_id,
          model_name: subflow.model_name,
          action: subflow.action,
          via: step.name,
        })

        const expanded = expandFlow(flowsById.get(subflow.flow_id), new Set(visited))
        for (const childSubflow of expanded.transitive_subflows) {
          transitiveSubflows.set(childSubflow.id, childSubflow)
        }
        for (const affect of expanded.derived_affects) {
          const key = [
            asString(affect.model_name),
            asString(affect.kind),
            asString(affect.name),
          ].join('|')
          if (!derivedByKey.has(key)) {
            derivedByKey.set(key, {
              ...affect,
              reason: `subflow:${subflow.flow_id}`,
            })
          }
        }
      }
    }

    return {
      derived_affects: Array.from(derivedByKey.values()),
      transitive_subflows: Array.from(transitiveSubflows.values()),
    }
  }

  return sortBy(
    flows.map((flow) => ({
      ...flow,
      ...expandFlow(flow),
    })),
    (flow) => flow.id,
  )
}

function mergeSnapshotLayers(core, derived) {
  const byId = new Map()

  for (const layer of [core, derived]) {
    for (const model of layer?.models || []) {
      const previous = byId.get(asString(model.id))
      byId.set(asString(model.id), {
        ...(previous || model),
        ...model,
        attrs: [...(previous?.attrs || []), ...(model.attrs || [])],
        rels: [...(previous?.rels || []), ...(model.rels || [])],
        actions: [...(previous?.actions || []), ...(model.actions || [])],
      })
    }
  }

  return {
    ...(core || {}),
    models: Array.from(byId.values()),
    attr_edges: [...(core?.attr_edges || []), ...(derived?.attr_edges || [])],
    rel_edges: [...(core?.rel_edges || []), ...(derived?.rel_edges || [])],
    action_edges: [...(core?.action_edges || []), ...(derived?.action_edges || [])],
  }
}

function enrichSnapshotLayer(layer, analysisLayer = layer) {
  if (!layer || typeof layer !== 'object') {
    return layer
  }

  const action_edges = collectActionEdgesFromLayer(layer, analysisLayer)
  const action_flows = buildActionFlows(layer, analysisLayer)

  return {
    ...layer,
    action_edges,
    action_flows,
    counts: {
      ...layer.counts,
      action_edges: action_edges.length,
      action_flows: action_flows.length,
    },
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
    action_flows: sortBy(layer.action_flows, (flow) => flow.id),
  }
}

function sortSnapshot(snapshot) {
  const analysisLayer = mergeSnapshotLayers(snapshot?.core, snapshot?.derived)
  const enriched = {
    ...snapshot,
    core: enrichSnapshotLayer(snapshot?.core, analysisLayer),
    derived: enrichSnapshotLayer(snapshot?.derived, analysisLayer),
  }

  return {
    ...enriched,
    core: sortSnapshotLayer(enriched.core),
    derived: sortSnapshotLayer(enriched.derived),
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
