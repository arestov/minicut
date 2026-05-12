const MODEL_WIDTH = 340
const MODEL_MIN_HEIGHT = 152
const MODEL_MAX_HEIGHT = 392

// Terminology: schema graph / structural review.
// This viewer turns a DKT structure snapshot into interactive model, rel,
// attr-dependency, and action-target graph layers.
// See ../../../dkt/docs/research-localfirst-ru/02-terminology-and-code-comments.md

const DETAIL_WIDTH = 280
const DETAIL_MIN_HEIGHT = 112
const DETAIL_MAX_HEIGHT = 172
const GHOST_WIDTH = 240
const GHOST_MIN_HEIGHT = 104
const GHOST_MAX_HEIGHT = 144
const LAYOUT_HORIZONTAL_GAP = 220

const LAYER_STYLE = {
  hierarchy: {
    color: '#71829b',
    dash: '6 5',
  },
  rel_schema: {
    color: '#62d6a3',
  },
  derived_rel: {
    color: '#f5b663',
    dash: '8 4',
  },
  attr_dep: {
    color: '#78a8ff',
    dash: '3 4',
  },
}

const CORE_REL_KINDS = new Set(['input', 'model', 'nest'])
const DERIVED_REL_KINDS = new Set(['comp', 'conj', 'sel'])
const BWLEV_NAME_EXPR = /^bwlev(($)|(:.+))/
const ROUTER_PREFIX = 'router-'
const INFRA_REL_NAMES = new Set([
  '$root',
  '$parent',
  'common_session_root',
  'sessions',
  'free_sessions',
])
const MODEL_NAME_PREFIX = 'minicut_'

const text = (value) => (value == null ? '' : String(value))

function isEnabledLayer(layers, name) {
  return layers?.[name] !== false
}

function flowModelId(id) {
  return `model:${text(id)}`
}

function flowRelDetailId(modelId, relName) {
  return `rel:${text(modelId)}:${relName}`
}

function flowGhostId(modelId, relName, reason) {
  return `ghost:${text(modelId)}:${relName}:${reason}`
}

function flowAttrId(modelId, attrName) {
  return `attr:${text(modelId)}:${attrName}`
}

function actionFlowKey(model, action) {
  return `${text(model?.model_name || model?.id)}.${text(action?.action_name || action?.name)}`
}

function relKey(modelId, relName) {
  return `rel:${text(modelId)}:${text(relName)}`
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function countRows(items, limit = Infinity) {
  return Math.min(Array.isArray(items) ? items.length : 0, limit)
}

function estimateModelHeight(model) {
  const relRows = countRows(model.rels, 7)
  const attrRows = countRows(model.attrs, 4)
  const actionRows = countRows(model.actions, 3)

  const bodyRows = Math.max(relRows, attrRows + actionRows)
  const estimated = 104 + bodyRows * 24

  return clamp(estimated, MODEL_MIN_HEIGHT, MODEL_MAX_HEIGHT)
}

function estimateDetailHeight(raw) {
  const labelRows = raw?.kind ? 1 : 0
  const estimated = 78 + labelRows * 18
  return clamp(estimated, DETAIL_MIN_HEIGHT, DETAIL_MAX_HEIGHT)
}

function estimateGhostHeight() {
  return GHOST_MIN_HEIGHT
}

function normalizeSize(size) {
  if (!size || typeof size !== 'object') {
    return null
  }

  const width = Number(size.width)
  const height = Number(size.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return {
    width,
    height,
  }
}

function sizeOverrideFor(sizeById, nodeId) {
  if (!sizeById) {
    return null
  }

  if (typeof sizeById.get === 'function') {
    return normalizeSize(sizeById.get(nodeId))
  }

  return normalizeSize(sizeById?.[nodeId])
}

function modelLabel(model) {
  const raw = model.model_name || model.hierarchy_name || `model ${text(model.id)}`
  if (raw.startsWith(MODEL_NAME_PREFIX)) {
    return raw.slice(MODEL_NAME_PREFIX.length)
  }
  return raw
}

function isBwlevName(name) {
  return BWLEV_NAME_EXPR.test(text(name))
}

function isRouterPath(path) {
  const parts = text(path).split('/').filter(Boolean)
  return parts[0] === '$session_root' && parts[1]?.startsWith(ROUTER_PREFIX)
}

function isInfraModel(model) {
  const name = modelLabel(model)
  const path = text(model?.hierarchy_path_string)
  return isBwlevName(name) || isRouterPath(path)
}

function isInfraRel(rel) {
  const name = text(rel?.name)
  return (
    INFRA_REL_NAMES.has(name) ||
    name.startsWith(ROUTER_PREFIX) ||
    name.startsWith('common_session_root')
  )
}

function countLabel(model) {
  return [
    `${model.attrs?.length || 0} attrs`,
    `${model.rels?.length || 0} rels`,
    `${model.actions?.length || 0} actions`,
  ].join(' / ')
}

function relLabel(rel) {
  const flags = [
    rel.many ? 'many' : 'one',
    rel.any ? 'any' : null,
    rel.uniq ? `uniq:${rel.uniq}` : null,
  ].filter(Boolean)

  return flags.length ? `${rel.name} (${flags.join(', ')})` : rel.name
}

function actionTargetLabel(target) {
  if (!target) {
    return 'target'
  }

  return (
    target.result_name ||
    target.target_path?.path_string ||
    target.path_type ||
    'target'
  )
}

function makeEdge(id, source, target, label, layer, extra = {}) {
  const style = LAYER_STYLE[layer] || LAYER_STYLE.rel_schema

  return {
    id,
    source,
    target,
    label,
    type: 'routed',
    animated: layer === 'derived_rel',
    markerEnd: {
      type: 'arrowclosed',
      color: style.color,
    },
    style: {
      stroke: style.color,
      strokeDasharray: style.dash || undefined,
      strokeWidth: layer === 'hierarchy' ? 1.4 : 1.8,
    },
    data: {
      layer,
      route: null,
      ...extra,
    },
  }
}

function makeModelNode(
  model,
  selectedModelId,
  showInfra = false,
  onMeasure = null,
  onNodeRelClick = null,
  onNodeRelPointerEnter = null,
  onNodeRelPointerLeave = null,
  onNodeActionClick = null,
  actionFlowsByKey = new Map(),
) {
  const id = flowModelId(model.id)
  const height = estimateModelHeight(model)
  const rels = (model.rels || [])
    .filter((rel) => showInfra || !isInfraRel(rel))
    .map((rel) => {
    return { ...rel, key: relKey(id, rel.name) }
    })

  return {
    id,
    type: 'model',
    position: { x: 0, y: 0 },
    width: MODEL_WIDTH,
    height,
    style: {
      width: `${MODEL_WIDTH}px`,
      minHeight: `${height}px`,
    },
    data: {
      category: 'model',
      nodeId: id,
      onMeasure,
      onNodeRelClick,
      onNodeRelPointerEnter,
      onNodeRelPointerLeave,
      onNodeActionClick,
      title: modelLabel(model),
      subtitle: model.hierarchy_path_string || 'root',
      badges: [
        model.meta?.is_root ? 'root' : null,
        countLabel(model),
      ].filter(Boolean),
      attrs: model.attrs || [],
      rels,
      actions: (model.actions || []).map((action) => ({
        ...action,
        flow: actionFlowsByKey.get(actionFlowKey(model, action)) || null,
      })),
      raw: model,
    },
    selected: text(model.id) === text(selectedModelId),
  }
}

function makeDetailNode(id, title, subtitle, category, raw, onMeasure = null) {
  const height = estimateDetailHeight(raw)
  return {
    id,
    type: 'model',
    position: { x: 0, y: 0 },
    width: DETAIL_WIDTH,
    height,
    style: {
      width: `${DETAIL_WIDTH}px`,
      minHeight: `${height}px`,
    },
    data: {
      category,
      nodeId: id,
      onMeasure,
      title,
      subtitle,
      badges: [category],
      attrs: [],
      rels: [],
      actions: [],
      raw,
    },
  }
}

function makeGhostNode(id, title, subtitle, raw, onMeasure = null) {
  const height = estimateGhostHeight(raw)
  return {
    id,
    type: 'model',
    position: { x: 0, y: 0 },
    width: GHOST_WIDTH,
    height,
    style: {
      width: `${GHOST_WIDTH}px`,
      minHeight: `${height}px`,
    },
    data: {
      category: 'ghost',
      nodeId: id,
      onMeasure,
      title,
      subtitle,
      badges: ['external'],
      attrs: [],
      rels: [],
      actions: [],
      raw,
    },
  }
}

function normalizeSnapshot(snapshot) {
  return {
    ...snapshot,
    models: Array.isArray(snapshot?.models) ? snapshot.models : [],
    hierarchy_edges: Array.isArray(snapshot?.hierarchy_edges)
      ? snapshot.hierarchy_edges
      : [],
  }
}

function buildModelIndexes(models) {
  const byId = new Map()
  const idsByName = new Map()

  for (const model of models) {
    const id = text(model.id)
    byId.set(id, model)

    const name = model.model_name || model.hierarchy_name
    if (!name) {
      continue
    }

    if (!idsByName.has(name)) {
      idsByName.set(name, [])
    }
    idsByName.get(name).push(id)
  }

  return { byId, idsByName }
}

function buildGraphContext(snapshot, modelsById, idsByName) {
  const rootModel =
    snapshot.models.find((model) => model.meta?.is_root) ||
    snapshot.models.find((model) => model.hierarchy_num === snapshot.root?.hierarchy_num) ||
    snapshot.models[0] ||
    null
  const relTargetsCache = new Map()

  return {
    rootId: rootModel ? text(rootModel.id) : null,
    modelsById,
    idsByName,
    relTargetsCache,
  }
}

function directRelTargetModelIds(rel, idsByName, modelsById = null) {
  const result = new Set()

  for (const ref of rel.child_model_refs || []) {
    const ids = idsByName.get(ref?.model_name) || []
    for (const id of ids) {
      const stringId = text(id)
      if (modelsById && !modelsById.has(stringId)) {
        continue
      }

      result.add(stringId)
    }
  }

  return Array.from(result)
}

function collectLinkingValues(linking, result = []) {
  if (linking == null) {
    return result
  }

  if (typeof linking === 'string') {
    result.push(linking)
    return result
  }

  if (Array.isArray(linking)) {
    for (const item of linking) {
      collectLinkingValues(item, result)
    }
    return result
  }

  if (typeof linking !== 'object') {
    return result
  }

  if (typeof linking.value === 'string') {
    result.push(linking.value)
  } else {
    collectLinkingValues(linking.value, result)
  }

  return result
}

function normalizePathPart(part) {
  return text(part)
    .trim()
    .replace(/^@[^:]+:/, '')
}

function normalizeLinkPath(value) {
  let path = text(value).trim()

  path = path.replace(/^<+\s*/, '')
  path = path.replace(/\s*<+\s*#?\s*$/, '')
  path = path.replace(/\s+#$/, '')
  path = path.trim()

  if (!path || path === '#') {
    return null
  }

  path = normalizePathPart(path)

  const firstToken = path.split(/\s+/)[0]
  if (!firstToken || firstToken === '#') {
    return null
  }

  return firstToken
}

function getModelRel(model, relName) {
  return (model?.rels || []).find((rel) => rel.name === relName) || null
}

function resolveRelTargetModelIds(modelId, relName, context, visited = new Set()) {
  const key = `${modelId}:${relName}`
  if (visited.has(key)) {
    return []
  }

  if (context.relTargetsCache.has(key)) {
    return context.relTargetsCache.get(key)
  }

  visited.add(key)

  const model = context.modelsById.get(text(modelId))
  const rel = getModelRel(model, relName)
  if (!rel) {
    visited.delete(key)
    context.relTargetsCache.set(key, [])
    return []
  }

  const directTargets = directRelTargetModelIds(
    rel,
    context.idsByName,
    context.modelsById,
  )
  if (directTargets.length) {
    visited.delete(key)
    context.relTargetsCache.set(key, directTargets)
    return directTargets
  }

  const targets = new Set()
  for (const path of collectLinkingValues(rel.linking).map(normalizeLinkPath).filter(Boolean)) {
    for (const target of resolvePathTargetModelIds(model, path, context, visited)) {
      targets.add(target)
    }
  }

  const result = Array.from(targets)
  visited.delete(key)
  context.relTargetsCache.set(key, result)
  return result
}

function resolvePathTargetModelIds(sourceModel, path, context, visited) {
  const parts = text(path)
    .split('.')
    .map(normalizePathPart)
    .filter(Boolean)

  if (!parts.length) {
    return []
  }

  let currentModelIds = [text(sourceModel.id)]

  if (parts[0] === '$root') {
    currentModelIds = context.rootId ? [context.rootId] : []
    parts.shift()
  } else if (parts[0] === '$parent') {
    const parentId = sourceModel.meta?.parent_id
    currentModelIds = parentId == null ? [] : [text(parentId)]
    parts.shift()
  }

  if (!parts.length) {
    return currentModelIds
  }

  for (const relName of parts) {
    const nextModelIds = new Set()

    for (const modelId of currentModelIds) {
      for (const targetId of resolveRelTargetModelIds(modelId, relName, context, visited)) {
        nextModelIds.add(targetId)
      }
    }

    currentModelIds = Array.from(nextModelIds)
    if (!currentModelIds.length) {
      break
    }
  }

  return currentModelIds
}

function relTargetIds(model, rel, context) {
  const directTargets = directRelTargetModelIds(
    rel,
    context.idsByName,
    context.modelsById,
  )
  const linkedTargets = directTargets.length
    ? directTargets
    : resolveRelTargetModelIds(model.id, rel.name, context)

  return linkedTargets.map(flowModelId)
}

function addRelGraph(nodesById, edges, model, rel, context, layers, options) {
  const source = flowModelId(model.id)
  const relId = relKey(source, rel.name)
  let targets = relTargetIds(model, rel, context)
  const layer = CORE_REL_KINDS.has(rel.kind) ? 'rel_schema' : 'derived_rel'
  const showUnknownTargets = isEnabledLayer(layers, 'unknown_targets')

  if (!targets.length && rel.any && showUnknownTargets) {
    const ghostId = flowGhostId(model.id, rel.name, 'any')
    nodesById.set(
      ghostId,
      makeGhostNode(
        ghostId,
        'Any target',
        `${rel.kind} ${rel.name}`,
        rel,
        options.onNodeMeasure,
      ),
    )
    targets = [ghostId]
  }

  if (!targets.length && DERIVED_REL_KINDS.has(rel.kind)) {
    const relId = flowRelDetailId(model.id, rel.name)
    nodesById.set(
      relId,
      makeDetailNode(
        relId,
        rel.name,
        `${rel.kind} rel`,
        'derived rel',
        rel,
        options.onNodeMeasure,
      ),
    )
    targets = [relId]
  }

  if (!targets.length && rel.linking && showUnknownTargets) {
    const ghostId = flowGhostId(model.id, rel.name, 'linked')
    nodesById.set(
      ghostId,
      makeGhostNode(
        ghostId,
        'Linked target',
        `${rel.kind} ${rel.name}`,
        rel,
        options.onNodeMeasure,
      ),
    )
    targets = [ghostId]
  }

  if (!targets.length) {
    return
  }

  for (const target of targets) {
    edges.push(
      makeEdge(
        `rel:${source}:${rel.name}:${target}`,
        source,
        target,
        relLabel(rel),
        layer,
        { rel, relKey: relId },
      ),
    )
  }
}

function addAttrGraph(nodesById, edges, model, options) {
  const source = flowModelId(model.id)

  for (const attr of model.attrs || []) {
    if (!attr?.deps?.length) {
      continue
    }

    const target = flowAttrId(model.id, attr.name)
    nodesById.set(
      target,
      makeDetailNode(target, attr.name, `${attr.kind} attr`, 'attr', attr, options.onNodeMeasure),
    )

    edges.push(
      makeEdge(
        `attr:${source}:${attr.name}`,
        source,
        target,
        attr.deps.slice(0, 3).join(', '),
        'attr_dep',
        { attr },
      ),
    )
  }
}

function addActionGraph() {
  // Action flows are shown inside model cards. Keep them off-canvas so actions
  // do not duplicate the model graph as synthetic nodes.
}

function addHierarchyGraph(edges, snapshot, modelsById) {
  for (const edge of snapshot.hierarchy_edges || []) {
    const from = text(edge.from)
    const to = text(edge.to)
    if (!modelsById.has(from) || !modelsById.has(to)) {
      continue
    }

    edges.push(
      makeEdge(
        `hierarchy:${from}:${to}`,
        flowModelId(from),
        flowModelId(to),
        edge.name || 'child',
        'hierarchy',
        { hierarchy: edge },
      ),
    )
  }
}

function filterVisibleModels(models, options) {
  if (options.showInfra) {
    return models
  }

  return models.filter((model) => !isInfraModel(model))
}

function matchesQuery(model, query) {
  if (!query) {
    return true
  }

  const haystack = [
    model.model_name,
    model.hierarchy_name,
    model.hierarchy_path_string,
    model.file_path,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(query.toLowerCase())
}

function filterNeighborhood(nodes, edges, selectedModelId, query, scope) {
  if (scope === 'all' && !query) {
    return { nodes, edges }
  }

  const seeds = new Set()
  const selectedFlowId = selectedModelId ? flowModelId(selectedModelId) : null

  if (selectedFlowId) {
    seeds.add(selectedFlowId)
  }

  for (const node of nodes) {
    if (node.data?.category !== 'model') {
      continue
    }

    if (matchesQuery(node.data.raw, query)) {
      seeds.add(node.id)
    }
  }

  if (!seeds.size) {
    return { nodes: [], edges: [] }
  }

  const visibleNodeIds = new Set(seeds)
  const visibleEdges = []

  for (const edge of edges) {
    const touchesSeed = seeds.has(edge.source) || seeds.has(edge.target)
    const matchesAllScope = scope === 'all' && (
      visibleNodeIds.has(edge.source) || visibleNodeIds.has(edge.target)
    )

    if (!touchesSeed && !matchesAllScope) {
      continue
    }

    visibleEdges.push(edge)
    visibleNodeIds.add(edge.source)
    visibleNodeIds.add(edge.target)
  }

  return {
    nodes: nodes.filter((node) => visibleNodeIds.has(node.id)),
    edges: visibleEdges,
  }
}

function applySizeOverrides(nodes, sizeById) {
  if (!sizeById) {
    return nodes
  }

  return nodes.map((node) => {
    const override = sizeOverrideFor(sizeById, node.id)
    if (!override) {
      return node
    }

    return {
      ...node,
      width: override.width,
      height: override.height,
      style: {
        ...node.style,
        width: `${override.width}px`,
        minHeight: `${override.height}px`,
      },
    }
  })
}

function weightKey(left, right) {
  return [left, right].sort().join('::')
}

function calculateSelectedWeights(edges, selectedModelId) {
  const selectedFlowId = selectedModelId ? flowModelId(selectedModelId) : null
  const weights = new Map()

  if (!selectedFlowId) {
    return weights
  }

  for (const edge of edges) {
    if (edge.source !== selectedFlowId && edge.target !== selectedFlowId) {
      continue
    }

    const other = edge.source === selectedFlowId ? edge.target : edge.source
    if (other === selectedFlowId) {
      continue
    }

    weights.set(other, (weights.get(other) || 0) + 1)
  }

  return weights
}

function calculateModelDegrees(nodes, edges) {
  const categoriesById = new Map(
    nodes.map((node) => [node.id, text(node.data?.category || 'model')]),
  )
  const degrees = new Map()

  for (const edge of edges) {
    if (categoriesById.get(edge.source) !== 'model' || categoriesById.get(edge.target) !== 'model') {
      continue
    }

    degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1)
    degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1)
  }

  return degrees
}

function orderNodesBySelectedWeight(nodes, edges, selectedModelId) {
  const selectedFlowId = selectedModelId ? flowModelId(selectedModelId) : null
  const weights = calculateSelectedWeights(edges, selectedModelId)
  const degrees = calculateModelDegrees(nodes, edges)
  const relationWeights = new Map()

  for (const edge of edges) {
    const key = weightKey(edge.source, edge.target)
    relationWeights.set(key, (relationWeights.get(key) || 0) + 1)
  }

  const weightedNodes = nodes.map((node) => {
    const directWeight = weights.get(node.id) || 0
    const degree = degrees.get(node.id) || 0
    const weight =
      node.id === selectedFlowId ? Number.MAX_SAFE_INTEGER : directWeight * 100 + degree

    return {
      ...node,
      data: {
        ...node.data,
        weight: weight === Number.MAX_SAFE_INTEGER ? null : weight,
        badges:
          directWeight > 0 && weight !== Number.MAX_SAFE_INTEGER
            ? [...(node.data?.badges || []), `links ${directWeight}`]
            : node.data?.badges || [],
      },
    }
  })

  return {
    nodes: weightedNodes.sort((left, right) => {
      if (left.id === selectedFlowId) {
        return -1
      }
      if (right.id === selectedFlowId) {
        return 1
      }

      const leftWeight = weights.get(left.id) || 0
      const rightWeight = weights.get(right.id) || 0
      if (leftWeight !== rightWeight) {
        return rightWeight - leftWeight
      }

      const leftDegree = degrees.get(left.id) || 0
      const rightDegree = degrees.get(right.id) || 0
      if (leftDegree !== rightDegree) {
        return rightDegree - leftDegree
      }

      return text(left.data?.title).localeCompare(text(right.data?.title))
    }),
    edges: edges.map((edge) => {
      const weight = relationWeights.get(weightKey(edge.source, edge.target)) || 1
      return {
        ...edge,
        data: {
          ...edge.data,
          weight,
        },
      }
    }),
  }
}

function stableSortGraph(nodes, edges) {
  return {
    nodes: nodes.slice().sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.slice().sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function fallbackGrid(nodes, edges) {
  return {
    nodes: nodes.map((node, index) => ({
      ...node,
      position: {
        x: (index % 4) * 360,
        y: Math.floor(index / 4) * 220,
      },
    })),
    edges,
  }
}

let elkPromise = null

async function getElk() {
  if (!elkPromise) {
    elkPromise = import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK())
  }

  return elkPromise
}

function elkNodeSize(node) {
  return {
    width: node.width || MODEL_WIDTH,
    height: node.height || MODEL_MIN_HEIGHT,
  }
}

function routeFromElk(edge) {
  const section = edge?.sections?.[0]
  if (!section?.startPoint || !section?.endPoint) {
    return null
  }

  return [
    section.startPoint,
    ...(section.bendPoints || []),
    section.endPoint,
  ].map((point) => ({
    x: point.x,
    y: point.y,
  }))
}

async function layoutFlowGraph(nodes, edges, options = {}) {
  if (!nodes.length) {
    return { nodes, edges }
  }

  const sizesById = new Map(nodes.map((node) => [node.id, elkNodeSize(node)]))
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.favorStraightEdges': 'false',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      'elk.layered.spacing.edgeNodeBetweenLayers': '36',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
      'elk.spacing.nodeNode': String(LAYOUT_HORIZONTAL_GAP),
      'elk.spacing.edgeNode': '34',
      'elk.spacing.edgeEdge': '18',
    },
    children: nodes.map((node) => {
      const size = sizesById.get(node.id)
      return {
        id: node.id,
        width: size.width,
        height: size.height,
        layoutOptions:
          node.id === flowModelId(options.selectedModelId)
            ? { 'elk.layered.priority': '1000' }
            : node.data?.weight
              ? { 'elk.layered.priority': String(node.data.weight) }
              : undefined,
      }
    }),
    edges: [
      ...edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        layoutOptions: edge.data?.weight
          ? { 'elk.priority': String(Math.min(100, edge.data.weight)) }
          : undefined,
      })),
    ],
  }

  try {
    const elk = await getElk()
    const layouted = await elk.layout(graph)
    const layoutedNodes = new Map(
      (layouted.children || []).map((node) => [node.id, node]),
    )
    const layoutedEdges = new Map(
      (layouted.edges || []).map((edge) => [edge.id, edge]),
    )

    return {
      nodes: nodes.map((node) => {
        const layoutedNode = layoutedNodes.get(node.id)
        const size = sizesById.get(node.id)
        return {
          ...node,
          width: size.width,
          height: size.height,
          position: {
            x: layoutedNode?.x || 0,
            y: layoutedNode?.y || 0,
          },
        }
      }),
      edges: edges.map((edge) => ({
        ...edge,
        data: {
          ...edge.data,
          route: routeFromElk(layoutedEdges.get(edge.id)),
        },
      })),
    }
  } catch (error) {
    console.warn('ELK layout failed, using grid layout', error)
    return fallbackGrid(nodes, edges)
  }
}

async function buildFlowGraph(snapshot, options = {}) {
  const normalized = normalizeSnapshot(snapshot)
  const visibleModels = filterVisibleModels(normalized.models, options)
  const { byId: modelsById, idsByName } = buildModelIndexes(visibleModels)
  const context = buildGraphContext(normalized, modelsById, idsByName)
  const actionFlowsByKey = new Map(
    (normalized.action_flows || []).map((flow) => [flow.id, flow]),
  )
  const graphOptions = {
    ...options,
    actionFlowsByKey,
  }
  const nodesById = new Map()
  const edges = []

  for (const model of visibleModels) {
    nodesById.set(
      flowModelId(model.id),
        makeModelNode(
          model,
          options.selectedModelId,
          options.showInfra,
          options.onNodeMeasure,
          options.onNodeRelClick,
          options.onNodeRelPointerEnter,
        options.onNodeRelPointerLeave,
          options.onNodeActionClick,
          actionFlowsByKey,
      ),
    )
  }

  if (isEnabledLayer(options.layers, 'hierarchy')) {
    addHierarchyGraph(edges, normalized, modelsById)
  }

  for (const model of visibleModels) {
    for (const rel of model.rels || []) {
      if (!options.showInfra && isInfraRel(rel)) {
        continue
      }

      const isCore = CORE_REL_KINDS.has(rel.kind)
      const isDerived = DERIVED_REL_KINDS.has(rel.kind)
      if (isCore && !isEnabledLayer(options.layers, 'rel_schema')) {
        continue
      }
      if (isDerived && !isEnabledLayer(options.layers, 'derived_rel')) {
        continue
      }

      addRelGraph(nodesById, edges, model, rel, context, options.layers, options)
    }

    if (isEnabledLayer(options.layers, 'attr_dep')) {
      addAttrGraph(nodesById, edges, model, options)
    }

    addActionGraph()
  }

  const sorted = stableSortGraph(Array.from(nodesById.values()), edges)
  const weighted = orderNodesBySelectedWeight(
    sorted.nodes,
    sorted.edges,
    options.selectedModelId,
  )
  const sizedNodes = applySizeOverrides(weighted.nodes, options.sizeById)

  return layoutFlowGraph(sizedNodes, weighted.edges, options)
}

function modelOptions(snapshot, options = {}) {
  return filterVisibleModels(normalizeSnapshot(snapshot).models, options)
    .slice()
    .sort((left, right) => {
      if (left?.meta?.is_root !== right?.meta?.is_root) {
        return left?.meta?.is_root ? -1 : 1
      }

      return modelLabel(left).localeCompare(modelLabel(right))
    })
    .map((model) => ({
      id: text(model.id),
      label: modelLabel(model),
      path: model.hierarchy_path_string || 'root',
      raw: model,
    }))
}

function rootModelOption(snapshot) {
  const normalized = normalizeSnapshot(snapshot)
  const root =
    normalized.models.find((model) => model.meta?.is_root) ||
    normalized.models.find((model) => model.hierarchy_num === normalized.root?.hierarchy_num) ||
    normalized.models[0] ||
    null

  if (!root) {
    return null
  }

  return {
    id: text(root.id),
    label: modelLabel(root),
    path: root.hierarchy_path_string || 'root',
    raw: root,
  }
}

export {
  buildFlowGraph,
  flowModelId,
  modelLabel,
  modelOptions,
  normalizeSnapshot,
  relKey,
  rootModelOption,
}
