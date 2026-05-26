<script>
  import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    Panel,
    SvelteFlow,
  } from '@xyflow/svelte'
  import '@xyflow/svelte/dist/style.css'
  import { onMount, setContext, tick } from 'svelte'

  import RoutedEdge from './edges/RoutedEdge.svelte'
  import {
    buildFlowGraph,
    flowModelId,
    modelOptions,
    normalizeSnapshot,
    rootModelOption,
  } from './graph/structureGraph.js'
  import {
    collectActionHighlight,
    serializeActionHighlight,
  } from './graph/actionHighlight.js'
  import { EDGE_UI_CONTEXT } from './graph/edgeUiContext.js'
  import ModelNode from './nodes/ModelNode.svelte'

  const nodeTypes = {
    model: ModelNode,
  }

  const edgeTypes = {
    routed: RoutedEdge,
  }
  const FOCUS_HOPS = 1

  let snapshots = $state({
    core: null,
    derived: null,
  })
  let selectedSlice = $state('core')
  let selectedModelId = $state('')
  let selectedItem = $state(null)
  let scope = $state('neighborhood')
  let query = $state('')
  let status = $state('Loading snapshots from ../../app-structure.snapshot...')
  let loading = $state(false)
  let graphBase = $state({ nodes: [], edges: [] })
  let layoutRequest = $state({
    snapshot: null,
    options: null,
    sizeById: null,
  })
  let layoutPhase = $state('estimate')
  let measuredSnapshot = null
  let measuredSizes = $state({})
  let nodes = $state.raw([])
  let edges = $state.raw([])
  let isModelMenuOpen = $state(false)
  let isInspectorOpen = $state(false)
  const edgeUi = $state({
    hoveredRelKey: '',
    selectedRelKey: '',
    selectedActionFlowId: '',
    selectedSubflowIds: [],
    actionRelKeys: [],
    selectedNodeId: '',
    activeNodeIds: [],
    activeEdgeIds: [],
    hoveredTargetNodeIds: [],
    selectedTargetNodeIds: [],
    actionTargetNodeIds: [],
  })
  let layers = $state({
    hierarchy: false,
    rel_schema: true,
    derived_rel: true,
    attr_dep: false,
    unknown_targets: false,
  })
  let showInfra = $state(false)

  let layoutRun = 0

  setContext(EDGE_UI_CONTEXT, edgeUi)

  const activeSnapshot = $derived(
    selectedSlice === 'derived'
      ? snapshots.derived || snapshots.core
      : snapshots.core || snapshots.derived,
  )
  const models = $derived(activeSnapshot ? modelOptions(activeSnapshot, { showInfra }) : [])
  const rootModel = $derived(activeSnapshot ? rootModelOption(activeSnapshot) : null)
  const selectedModel = $derived(
    models.find((model) => model.id === selectedModelId) || rootModel || models[0] || null,
  )
  const countsText = $derived.by(() => {
    if (!activeSnapshot) {
      return 'No snapshot loaded'
    }

    const count = activeSnapshot.counts || {}
    return [
      `${count.models ?? activeSnapshot.models?.length ?? 0} models`,
      `${count.rel_edges ?? activeSnapshot.rel_edges?.length ?? 0} rel edges`,
      `${count.attr_edges ?? activeSnapshot.attr_edges?.length ?? 0} attr edges`,
      `${count.action_edges ?? activeSnapshot.action_edges?.length ?? 0} action edges`,
    ].join(' / ')
  })
  const inspectorTitle = $derived.by(() => {
    const item = selectedItem

    if (!item || typeof item !== 'object') {
      return 'none'
    }

    return (
      item.model_name ||
      item.name ||
      item.label ||
      item.title ||
      item.key ||
      item.id ||
      'none'
    )
  })
  const selectedJson = $derived(
    selectedItem ? JSON.stringify(selectedItem, null, 2) : 'Select a model or edge.',
  )

  function miniMapColor(node) {
    if (node.data?.category === 'ghost') {
      return '#f06f92'
    }
    if (node.data?.category === 'model') {
      return '#62d6a3'
    }
    return '#f5b663'
  }

  function normalizeMeasuredSize(size) {
    if (!size || typeof size !== 'object') {
      return null
    }

    const id = size.id == null ? '' : String(size.id).trim()
    const width = Math.round(Number(size.width))
    const height = Math.round(Number(size.height))

    if (!id || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null
    }

    return {
      id,
      width,
      height,
    }
  }

  function allVisibleNodesMeasured(graphNodes) {
    if (!Array.isArray(graphNodes) || !graphNodes.length) {
      return true
    }

    return graphNodes.every((node) => Boolean(measuredSizes[node.id]))
  }

  function maybeRequestMeasuredLayout(graphNodes = nodes) {
    if (layoutPhase !== 'collecting') {
      return false
    }

    if (!layoutRequest.snapshot || layoutRequest.sizeById) {
      return false
    }

    if (!allVisibleNodesMeasured(graphNodes)) {
      return false
    }

    layoutPhase = 'reflowing'
    layoutRequest = {
      ...layoutRequest,
      sizeById: {
        ...measuredSizes,
      },
    }

    return true
  }

  function recordNodeMeasure(size, runToken) {
    if (runToken !== layoutRun) {
      return
    }

    const measured = normalizeMeasuredSize(size)
    if (!measured) {
      return
    }

    const previous = measuredSizes[measured.id]
    if (
      previous?.width === measured.width &&
      previous?.height === measured.height
    ) {
      return
    }

    measuredSizes = {
      ...measuredSizes,
      [measured.id]: {
        width: measured.width,
        height: measured.height,
      },
    }

    if (layoutPhase === 'collecting') {
      maybeRequestMeasuredLayout()
    }
  }

  function setHoveredEdgeKey(nextKey) {
    if (edgeUi.hoveredRelKey === nextKey) {
      return
    }

    edgeUi.hoveredRelKey = nextKey
  }

  function setSelectedEdgeKey(nextKey) {
    if (edgeUi.selectedRelKey === nextKey) {
      return
    }

    edgeUi.selectedRelKey = nextKey
  }

  function setSelectedActionFlowId(nextId) {
    if (edgeUi.selectedActionFlowId === nextId) {
      return
    }

    edgeUi.selectedActionFlowId = nextId
  }

  function setSelectedSubflowIds(nextIds) {
    const normalized = [...(nextIds || [])].filter(Boolean).sort()
    if (arraysEqual(edgeUi.selectedSubflowIds || [], normalized)) {
      return
    }

    edgeUi.selectedSubflowIds = normalized
  }

  function setSelectedNodeId(nextId) {
    if (edgeUi.selectedNodeId === nextId) {
      return
    }

    edgeUi.selectedNodeId = nextId
  }

  function arraysEqual(left = [], right = []) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  function collectTargetNodeIds(relKey, currentEdges = graphBase.edges) {
    if (!relKey) {
      return []
    }

    return currentEdges
      .filter((edge) => edge?.data?.relKey === relKey && edge?.target)
      .map((edge) => edge.target)
  }

  function selectedActionFlow() {
    const flowId = edgeUi.selectedActionFlowId || ''
    if (!flowId || !activeSnapshot?.action_flows?.length) {
      return null
    }

    return activeSnapshot.action_flows.find((flow) => flow.id === flowId) || null
  }

  function collectActionFlowIds(flow) {
    if (!flow) {
      return new Set()
    }

    return new Set([
      flow.id,
      ...(flow.transitive_subflows || []).map((subflow) => subflow.id).filter(Boolean),
    ])
  }

  function selectedActionHighlight() {
    return serializeActionHighlight(collectActionHighlight(activeSnapshot, selectedActionFlow()))
  }

  function collectActionModelNames(flow) {
    const names = new Set()
    if (!flow) {
      return names
    }

    if (flow.model_name) {
      names.add(flow.model_name)
    }

    for (const step of flow.steps || []) {
      for (const write of step.writes || []) {
        if (write.model_name) {
          names.add(write.model_name)
        }
      }
      for (const subflow of step.subflows || []) {
        if (subflow.model_name) {
          names.add(subflow.model_name)
        }
      }
    }

    for (const subflow of flow.transitive_subflows || []) {
      if (subflow.model_name) {
        names.add(subflow.model_name)
      }
    }

    for (const affect of flow.derived_affects || []) {
      if (affect.model_name) {
        names.add(affect.model_name)
      }
    }

    return names
  }

  function collectActionTargetNodeIds(flow, baseNodes = graphBase.nodes) {
    const highlightedIds = new Set(selectedActionHighlight().nodeIds)
    return baseNodes
      .filter((node) => highlightedIds.has(node.id))
      .map((node) => node.id)
  }

  function matchesModelQuery(model, nextQuery) {
    const normalizedQuery = String(nextQuery || '').trim().toLowerCase()
    if (!normalizedQuery) {
      return false
    }

    const haystack = [
      model?.model_name,
      model?.hierarchy_name,
      model?.hierarchy_path_string,
      model?.file_path,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  }

  function buildFocusView(baseNodes = graphBase.nodes, baseEdges = graphBase.edges) {
    const activeNodeIds = new Set()
    const activeEdgeIds = new Set()

    if (!Array.isArray(baseNodes) || !baseNodes.length) {
      return { activeNodeIds, activeEdgeIds }
    }

    if (scope === 'all') {
      for (const node of baseNodes) {
        activeNodeIds.add(node.id)
      }

      for (const edge of baseEdges) {
        activeEdgeIds.add(edge.id)
      }
    } else {
      const seedNodeIds = new Set()
      const selectedFlowId = selectedModelId ? flowModelId(selectedModelId) : ''
      const depthByNodeId = new Map()

      if (selectedFlowId) {
        seedNodeIds.add(selectedFlowId)
      }

      for (const node of baseNodes) {
        if (node.data?.category !== 'model') {
          continue
        }

        if (matchesModelQuery(node.data?.raw, query)) {
          seedNodeIds.add(node.id)
        }
      }

      if (!seedNodeIds.size) {
        for (const node of baseNodes) {
          activeNodeIds.add(node.id)
        }
        for (const edge of baseEdges) {
          activeEdgeIds.add(edge.id)
        }
      } else {
        const queue = []
        for (const nodeId of seedNodeIds) {
          depthByNodeId.set(nodeId, 0)
          queue.push(nodeId)
        }

        while (queue.length) {
          const currentNodeId = queue.shift()
          const currentDepth = depthByNodeId.get(currentNodeId) ?? 0

          if (currentDepth >= FOCUS_HOPS) {
            continue
          }

          for (const edge of baseEdges) {
            if (!edge?.source || !edge?.target) {
              continue
            }

            let nextNodeId = ''
            if (edge.source === currentNodeId) {
              nextNodeId = edge.target
            } else if (edge.target === currentNodeId) {
              nextNodeId = edge.source
            }

            if (!nextNodeId || depthByNodeId.has(nextNodeId)) {
              continue
            }

            depthByNodeId.set(nextNodeId, currentDepth + 1)
            queue.push(nextNodeId)
          }
        }

        for (const nodeId of depthByNodeId.keys()) {
          activeNodeIds.add(nodeId)
        }

        for (const edge of baseEdges) {
          const sourceDepth = depthByNodeId.get(edge.source)
          const targetDepth = depthByNodeId.get(edge.target)
          const touchesVisibleNeighborhood =
            sourceDepth != null &&
            targetDepth != null &&
            Math.min(sourceDepth, targetDepth) < FOCUS_HOPS

          if (!touchesVisibleNeighborhood) {
            continue
          }

          activeEdgeIds.add(edge.id)
          activeNodeIds.add(edge.source)
          activeNodeIds.add(edge.target)
        }
      }
    }

    if (edgeUi.selectedNodeId) {
      activeNodeIds.add(edgeUi.selectedNodeId)
    }

    const focusRelKeys = [edgeUi.selectedRelKey, edgeUi.hoveredRelKey].filter(Boolean)
    const actionRelKeys = edgeUi.actionRelKeys || []
    for (const relKey of actionRelKeys) {
      if (relKey && !focusRelKeys.includes(relKey)) {
        focusRelKeys.push(relKey)
      }
    }

    if (focusRelKeys.length) {
      for (const edge of baseEdges) {
        if (!focusRelKeys.includes(edge?.data?.relKey)) {
          continue
        }

        activeEdgeIds.add(edge.id)
        activeNodeIds.add(edge.source)
        activeNodeIds.add(edge.target)
      }
    }

    const actionFlow = selectedActionFlow()
    if (actionFlow) {
      for (const nodeId of collectActionTargetNodeIds(actionFlow, baseNodes)) {
        activeNodeIds.add(nodeId)
      }
    }

    return { activeNodeIds, activeEdgeIds }
  }

  function findRelKeyToSelectedModel(targetNodeId, currentEdges = graphBase.edges) {
    const sourceNodeId = selectedModelId ? flowModelId(selectedModelId) : ''
    const relEdges = currentEdges.filter((edge) => Boolean(edge?.data?.relKey))

    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId || !relEdges.length) {
      return ''
    }

    const queue = [sourceNodeId]
    const visited = new Set([sourceNodeId])
    const parentByNodeId = new Map()

    while (queue.length) {
      const nodeId = queue.shift()
      if (!nodeId) {
        continue
      }

      if (nodeId === targetNodeId) {
        break
      }

      for (const edge of relEdges) {
        if (!edge?.source || !edge?.target) {
          continue
        }

        let nextNodeId = ''
        if (edge.source === nodeId) {
          nextNodeId = edge.target
        } else if (edge.target === nodeId) {
          nextNodeId = edge.source
        }

        if (!nextNodeId || visited.has(nextNodeId)) {
          continue
        }

        visited.add(nextNodeId)
        parentByNodeId.set(nextNodeId, {
          nodeId,
          edge,
        })
        queue.push(nextNodeId)
      }
    }

    if (!visited.has(targetNodeId)) {
      return ''
    }

    const pathEdges = []
    let currentNodeId = targetNodeId

    while (currentNodeId !== sourceNodeId) {
      const parent = parentByNodeId.get(currentNodeId)
      if (!parent) {
        break
      }

      pathEdges.push(parent.edge)
      currentNodeId = parent.nodeId
    }

    pathEdges.reverse()

    for (const edge of pathEdges) {
      if (edge?.data?.relKey) {
        return edge.data.relKey
      }
    }

    return ''
  }

  async function readJson(url) {
    const response = await fetch(url, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`${url}: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async function loadDefaultSnapshots() {
    try {
      const core = normalizeSnapshot(await readJson('/snapshot/core.json'))
      let derived = null

      try {
        derived = normalizeSnapshot(await readJson('/snapshot/derived.json'))
      } catch (error) {
        console.warn('Derived snapshot is not available', error)
      }

      snapshots = {
        core,
        derived,
      }
      selectedSlice = core ? 'core' : 'derived'
      const root = rootModelOption(core || derived)
      selectedModelId = root?.id || ''
      selectedItem = root?.raw || null
      setSelectedNodeId(root?.id ? flowModelId(root.id) : '')
      setSelectedEdgeKey('')
      setSelectedActionFlowId('')
      setHoveredEdgeKey('')
      status = `Loaded ${core?.root?.model_name || derived?.root?.model_name || 'snapshot'}`
    } catch (error) {
      status = `Snapshot route is empty: ${error.message}. Use the file picker or run npm run structure:snapshot.`
    }
  }

  async function loadFiles(event) {
    const files = Array.from(event.currentTarget.files || [])
    const next = {
      core: snapshots.core,
      derived: snapshots.derived,
    }

    for (const file of files) {
      const path = file.webkitRelativePath || file.name
      if (!path.endsWith('core.json') && !path.endsWith('derived.json')) {
        continue
      }

      const payload = normalizeSnapshot(JSON.parse(await file.text()))
      if (path.endsWith('core.json')) {
        next.core = payload
      } else {
        next.derived = payload
      }
    }

    snapshots = next
    selectedSlice = next.core ? 'core' : 'derived'
    const root = rootModelOption(next.core || next.derived)
    selectedModelId = root?.id || ''
    selectedItem = root?.raw || null
    setSelectedNodeId(root?.id ? flowModelId(root.id) : '')
    setSelectedEdgeKey('')
    setSelectedActionFlowId('')
    setHoveredEdgeKey('')
    status = 'Loaded snapshot from file picker'
  }

  function selectModel(id) {
    selectedModelId = id
    selectedItem = models.find((model) => model.id === id)?.raw || null
    setSelectedNodeId(id ? flowModelId(id) : '')
    setSelectedEdgeKey('')
    setSelectedActionFlowId('')
    setHoveredEdgeKey('')
    isModelMenuOpen = false
  }

  function handleNodeClick(event, node) {
    const flowNode = node || event?.node || event?.detail?.node
    if (!flowNode) {
      return
    }

    setSelectedNodeId(flowNode.id || '')

    const relKey = findRelKeyToSelectedModel(flowNode.id || '')
    if (relKey) {
      setSelectedEdgeKey(relKey)
    } else {
      setSelectedEdgeKey('')
    }
    setSelectedActionFlowId('')

    selectedItem = flowNode.data?.raw || flowNode
  }

  function handleNodePointerEnter(event, node) {
    const flowNode = node || event?.node || event?.detail?.node
    if (!flowNode) {
      return
    }

    const relKey = findRelKeyToSelectedModel(flowNode.id || '')
    if (!relKey) {
      return
    }

    setHoveredEdgeKey(relKey)
  }

  function handleNodePointerLeave(event, node) {
    const flowNode = node || event?.node || event?.detail?.node
    if (!flowNode) {
      return
    }

    const relKey = findRelKeyToSelectedModel(flowNode.id || '')
    if (relKey && edgeUi.hoveredRelKey === relKey) {
      setHoveredEdgeKey('')
    }
  }

  function handleNodeRelClick(model, rel) {
    const relKey = rel?.key || ''
    setSelectedNodeId(model?.id == null ? '' : flowModelId(model.id))
    setSelectedEdgeKey(relKey)
    setSelectedActionFlowId('')
    selectedItem = rel || model || null
  }

  function handleNodeRelPointerEnter(rel) {
    setHoveredEdgeKey(rel?.key || '')
  }

  function handleNodeRelPointerLeave(rel) {
    const relKey = rel?.key || ''
    if (edgeUi.hoveredRelKey === relKey) {
      setHoveredEdgeKey('')
    }
  }

  function handleNodeActionClick(model, action) {
    setSelectedNodeId(model?.id == null ? '' : flowModelId(model.id))
    setSelectedEdgeKey('')
    setHoveredEdgeKey('')
    setSelectedActionFlowId(action?.flow?.id || '')
    selectedItem = action?.flow || action || model || null
    isInspectorOpen = true
  }

  function handleEdgeClick(event, edge) {
    const flowEdge = edge || event?.edge || event?.detail?.edge
    if (!flowEdge) {
      return
    }

    const relKey = flowEdge.data?.relKey || ''
    setSelectedNodeId(flowEdge.source || '')
    setSelectedEdgeKey(relKey)
    setSelectedActionFlowId(flowEdge.data?.action?.flow?.id || '')

    selectedItem =
      flowEdge.data?.rel ||
      flowEdge.data?.action ||
      flowEdge.data?.attr ||
      flowEdge.data?.hierarchy ||
      flowEdge
  }

  function handleEdgePointerEnter(event, edge) {
    const flowEdge = edge || event?.edge || event?.detail?.edge
    if (!flowEdge?.data?.rel) {
      return
    }

    setHoveredEdgeKey(flowEdge.data?.relKey || '')
  }

  function handleEdgePointerLeave(event, edge) {
    const flowEdge = edge || event?.edge || event?.detail?.edge
    if (!flowEdge?.data?.rel) {
      return
    }

    const relKey = flowEdge.data?.relKey || ''
    if (edgeUi.hoveredRelKey === relKey) {
      setHoveredEdgeKey('')
    }
  }

  $effect(() => {
    const nextTargetNodeIds = collectTargetNodeIds(edgeUi.selectedRelKey, graphBase.edges)
    const currentTargetNodeIds = edgeUi.selectedTargetNodeIds || []
    if (!arraysEqual(currentTargetNodeIds, nextTargetNodeIds)) {
      edgeUi.selectedTargetNodeIds = nextTargetNodeIds
    }
  })

  $effect(() => {
    const nextTargetNodeIds = collectTargetNodeIds(edgeUi.hoveredRelKey, graphBase.edges)
    const currentTargetNodeIds = edgeUi.hoveredTargetNodeIds || []
    if (!arraysEqual(currentTargetNodeIds, nextTargetNodeIds)) {
      edgeUi.hoveredTargetNodeIds = nextTargetNodeIds
    }
  })

  $effect(() => {
    const nextTargetNodeIds = collectActionTargetNodeIds(selectedActionFlow(), graphBase.nodes)
    const currentTargetNodeIds = edgeUi.actionTargetNodeIds || []
    if (!arraysEqual(currentTargetNodeIds, nextTargetNodeIds)) {
      edgeUi.actionTargetNodeIds = nextTargetNodeIds
    }
  })

  $effect(() => {
    const highlight = selectedActionHighlight()
    setSelectedSubflowIds(highlight.subflowIds)

    if (!arraysEqual(edgeUi.actionRelKeys || [], highlight.relKeys)) {
      edgeUi.actionRelKeys = highlight.relKeys
    }
  })

  $effect(() => {
    const snapshot = activeSnapshot
    const currentRun = layoutRun + 1
    const layoutAnchorModelId = rootModel?.id || models[0]?.id || ''
    const options = {
      selectedModelId: layoutAnchorModelId,
      showInfra,
      layers: {
        hierarchy: layers.hierarchy,
        rel_schema: layers.rel_schema,
        derived_rel: layers.derived_rel,
        attr_dep: layers.attr_dep,
        unknown_targets: layers.unknown_targets,
      },
      onNodeMeasure: (size) => recordNodeMeasure(size, currentRun),
      onNodeRelClick: handleNodeRelClick,
      onNodeRelPointerEnter: handleNodeRelPointerEnter,
      onNodeRelPointerLeave: handleNodeRelPointerLeave,
      onNodeActionClick: handleNodeActionClick,
    }

    if (!snapshot) {
      layoutRun += 1
      layoutPhase = 'estimate'
      measuredSnapshot = null
      measuredSizes = {}
      graphBase = { nodes: [], edges: [] }
      setSelectedNodeId('')
      nodes = []
      edges = []
      loading = false
      layoutRequest = {
        snapshot: null,
        options: null,
        sizeById: null,
      }
      measuredSizes = {}
      return
    }

    if (snapshot !== measuredSnapshot) {
      measuredSnapshot = snapshot
      measuredSizes = {}
    }

    layoutPhase = 'estimate'
    layoutRequest = {
      snapshot,
      options,
      sizeById: null,
    }

    layoutRun = currentRun
    loading = true

    buildFlowGraph(snapshot, options).then((graph) => {
      if (currentRun !== layoutRun) {
        return
      }

      graphBase = graph
      nodes = graph.nodes
      edges = graph.edges
      loading = false

      layoutPhase = 'collecting'

      tick().then(() => {
        if (currentRun !== layoutRun) {
          return
        }

        maybeRequestMeasuredLayout(graph.nodes)
      })
    })
  })

  $effect(() => {
    const request = layoutRequest
    const snapshot = request.snapshot
    const options = request.options

    if (!snapshot || !options || !request.sizeById) {
      return
    }

    const currentRun = layoutRun
    loading = true

    buildFlowGraph(snapshot, {
      ...options,
      sizeById: request.sizeById,
    }).then((graph) => {
      if (currentRun !== layoutRun) {
        return
      }

      graphBase = graph
      nodes = graph.nodes
      edges = graph.edges
      loading = false
      layoutPhase = 'settled'
    })
  })

  $effect(() => {
    const snapshot = activeSnapshot
    const nextSelectedModel = models.find((model) => model.id === selectedModelId) || null
    const fallbackModel = rootModel || models[0] || null

    if (!snapshot) {
      return
    }

    if (nextSelectedModel) {
      return
    }

    selectedModelId = fallbackModel?.id || ''
    selectedItem = fallbackModel?.raw || null
    setSelectedNodeId(fallbackModel?.id ? flowModelId(fallbackModel.id) : '')
    setSelectedEdgeKey('')
    setSelectedActionFlowId('')
    setHoveredEdgeKey('')
  })

  $effect(() => {
    const baseNodes = graphBase.nodes || []
    const baseEdges = graphBase.edges || []
    const { activeNodeIds, activeEdgeIds } = buildFocusView(baseNodes, baseEdges)
    const nextActiveNodeIds = Array.from(activeNodeIds).sort()
    const nextActiveEdgeIds = Array.from(activeEdgeIds).sort()

    if (!arraysEqual(edgeUi.activeNodeIds || [], nextActiveNodeIds)) {
      edgeUi.activeNodeIds = nextActiveNodeIds
    }

    if (!arraysEqual(edgeUi.activeEdgeIds || [], nextActiveEdgeIds)) {
      edgeUi.activeEdgeIds = nextActiveEdgeIds
    }
  })

  onMount(loadDefaultSnapshots)
</script>

<svelte:head>
  <title>DKT Structure Graph</title>
</svelte:head>

<div class="app-shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">DKT Structure Graph</p>
      <h1>Model / rel schema viewer</h1>
      <p class="status">{status}</p>
    </div>

    <div class="toolbar">
      <label>
        Slice
        <select bind:value={selectedSlice}>
          <option value="core">core</option>
          <option value="derived">derived</option>
        </select>
      </label>

      <label>
        Scope
        <select bind:value={scope}>
          <option value="neighborhood">selected neighborhood</option>
          <option value="all">all graph</option>
        </select>
      </label>

      <label class="file-picker">
        Snapshot folder
        <input type="file" webkitdirectory directory multiple onchange={loadFiles} />
      </label>
    </div>
  </header>

  <section class="filters">
    <input
      class="search"
      type="search"
      placeholder="Filter by model name, path, file..."
      bind:value={query}
    />

    <label><input type="checkbox" bind:checked={layers.hierarchy} /> hierarchy</label>
    <label><input type="checkbox" bind:checked={layers.rel_schema} /> rel schema</label>
    <label><input type="checkbox" bind:checked={layers.derived_rel} /> derived rels</label>
    <label><input type="checkbox" bind:checked={layers.attr_dep} /> attr deps</label>
    <label><input type="checkbox" bind:checked={layers.unknown_targets} /> unknown targets</label>
    <label><input type="checkbox" bind:checked={showInfra} /> infra</label>
  </section>

  <main class="workspace">
    <section class="graph-panel">
      {#if loading}
        <div class="layout-status">ELK layout...</div>
      {/if}

      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        {edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.12}
        maxZoom={1.8}
        nodesConnectable={false}
        nodesDraggable={false}
        onnodeclick={handleNodeClick}
        onnodepointerenter={handleNodePointerEnter}
        onnodepointerleave={handleNodePointerLeave}
        onedgeclick={handleEdgeClick}
        onedgepointerenter={handleEdgePointerEnter}
        onedgepointerleave={handleEdgePointerLeave}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.4} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={miniMapColor} />
        <Panel position="top-left">
          <div class="overlay-stack overlay-stack-left">
            <button
              class:active={isModelMenuOpen}
              class="panel-toggle"
              type="button"
              aria-expanded={isModelMenuOpen}
              onclick={() => (isModelMenuOpen = !isModelMenuOpen)}
            >
              <span>Models</span>
              <strong>{models.length}</strong>
            </button>

            {#if isModelMenuOpen}
              <section class="panel dropdown-panel model-list-dropdown">
                <div class="panel-head">
                  <h2>Models</h2>
                  <span>{models.length}</span>
                </div>

                <div class="model-scroll">
                  {#each models as model}
                    <button
                      class:selected={model.id === selectedModelId}
                      type="button"
                      onclick={() => selectModel(model.id)}
                    >
                      <strong>{model.label}</strong>
                      <span>{model.path}</span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}

            <div class="flow-chip">{countsText}</div>
          </div>
        </Panel>

        <Panel position="top-right">
          <div class="overlay-stack overlay-stack-right">
            <button
              class:active={isInspectorOpen}
              class="panel-toggle panel-toggle-inspector"
              type="button"
              aria-expanded={isInspectorOpen}
              onclick={() => (isInspectorOpen = !isInspectorOpen)}
            >
              <span>Inspector</span>
              <strong>{inspectorTitle}</strong>
            </button>

            {#if isInspectorOpen}
              <section class="panel dropdown-panel inspector-dropdown">
                <div class="panel-head">
                  <h2>Inspector</h2>
                  <span>{inspectorTitle}</span>
                </div>

                <pre class="inspector-body">{selectedJson}</pre>
              </section>
            {/if}
          </div>
        </Panel>
      </SvelteFlow>
    </section>
  </main>
</div>
