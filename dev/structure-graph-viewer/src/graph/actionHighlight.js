const text = (value) => (value == null ? '' : String(value))

const tokenizePath = (value) => text(value).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []

function flowModelId(id) {
  return `model:${text(id)}`
}

function relKey(modelId, relName) {
  return `rel:${text(modelId)}:${text(relName)}`
}

function buildModelIndexes(snapshot) {
  const models = Array.isArray(snapshot?.models) ? snapshot.models : []
  return {
    byName: new Map(models.map((model) => [model.model_name, model])),
    byId: new Map(models.map((model) => [text(model.id), model])),
  }
}

function findRelTargetModelName(model, relName) {
  const rel = (model?.rels || []).find((item) => item?.name === relName)
  const ref = rel?.child_model_refs?.find((item) => item?.model_name)
  return ref?.model_name || null
}

function addRelKey(result, model, relName) {
  if (!model || !relName) {
    return
  }

  const hasRel = (model.rels || []).some((rel) => rel?.name === relName)
  if (!hasRel) {
    return
  }

  result.relKeys.add(relKey(flowModelId(model.id), relName))
}

function addDependencyRelKeys(result, model, deps = [], modelsByName) {
  for (const dep of deps || []) {
    addRelPathKeys(result, model, dep)
  }
}

function addRelPathKeys(result, rootModel, path, modelsByName) {
  let currentModel = rootModel
  const tokens = tokenizePath(path).filter((token) => !['self', 'this'].includes(token))

  for (const token of tokens) {
    if (!currentModel) {
      return
    }

    addRelKey(result, currentModel, token)

    const targetName = findRelTargetModelName(currentModel, token)
    if (!targetName) {
      return
    }

    result.modelNames.add(targetName)
    currentModel = modelsByName?.get(targetName)
  }
}

function mergeHighlight(target, source) {
  for (const key of ['modelNames', 'nodeIds', 'relKeys', 'flowIds', 'subflowIds']) {
    for (const value of source[key] || []) {
      target[key].add(value)
    }
  }
}

function collectActionHighlight(snapshot, flow, visited = new Set()) {
  const result = {
    modelNames: new Set(),
    nodeIds: new Set(),
    relKeys: new Set(),
    flowIds: new Set(),
    subflowIds: new Set(),
  }

  if (!flow) {
    return result
  }

  if (visited.has(flow.id)) {
    return result
  }

  visited.add(flow.id)

  const { byName } = buildModelIndexes(snapshot)
  const flowsById = new Map((snapshot?.action_flows || []).map((item) => [item.id, item]))
  const rootFlowModel = byName.get(flow.model_name)
  result.flowIds.add(flow.id)

  if (flow.model_name) {
    result.modelNames.add(flow.model_name)
  }

  for (const subflow of flow.transitive_subflows || []) {
    if (subflow.id) {
      result.subflowIds.add(subflow.id)
      result.flowIds.add(subflow.id)
    }
    if (subflow.model_name) {
      result.modelNames.add(subflow.model_name)
    }
  }

  for (const step of flow.steps || []) {
    addDependencyRelKeys(result, rootFlowModel, step.deps, byName)

    for (const write of step.writes || []) {
      if (write.model_name) {
        result.modelNames.add(write.model_name)
      }
      if (write.kind === 'rel') {
        addRelKey(result, byName.get(write.model_name || flow.model_name), write.name)
      }
      if (write.kind === 'create' && write.model_name) {
        result.modelNames.add(write.model_name)
      }
      const shapeRels = write.creation_shape?.rels
      if (shapeRels && typeof shapeRels === 'object') {
        for (const relName of Object.keys(shapeRels)) {
          addRelKey(result, byName.get(write.model_name), relName)
          const targetName = findRelTargetModelName(byName.get(write.model_name), relName)
          if (targetName) {
            result.modelNames.add(targetName)
          }
        }
      }
    }

    for (const subflow of step.subflows || []) {
      addRelPathKeys(result, rootFlowModel, subflow.path, byName)
      if (subflow.model_name) {
        result.modelNames.add(subflow.model_name)
      }
      if (subflow.flow_id) {
        result.subflowIds.add(subflow.flow_id)
        result.flowIds.add(subflow.flow_id)
        mergeHighlight(
          result,
          collectActionHighlight(snapshot, flowsById.get(subflow.flow_id), new Set(visited)),
        )
      }
    }
  }

  for (const affect of flow.derived_affects || []) {
    if (affect.model_name) {
      result.modelNames.add(affect.model_name)
    }
  }

  for (const modelName of result.modelNames) {
    const model = byName.get(modelName)
    if (model) {
      result.nodeIds.add(flowModelId(model.id))
    }
  }

  return result
}

function serializeActionHighlight(highlight) {
  return {
    modelNames: [...(highlight?.modelNames || [])].sort(),
    nodeIds: [...(highlight?.nodeIds || [])].sort(),
    relKeys: [...(highlight?.relKeys || [])].sort(),
    flowIds: [...(highlight?.flowIds || [])].sort(),
    subflowIds: [...(highlight?.subflowIds || [])].sort(),
  }
}

export {
  collectActionHighlight,
  serializeActionHighlight,
}
