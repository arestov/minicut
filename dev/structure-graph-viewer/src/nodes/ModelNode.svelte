<script>
  import { Handle, Position } from '@xyflow/svelte'
  import { getContext, onDestroy, onMount } from 'svelte'
  import { EDGE_UI_CONTEXT } from '../graph/edgeUiContext.js'

  const edgeUi = getContext(EDGE_UI_CONTEXT) ?? {
    hoveredRelKey: '',
    selectedRelKey: '',
    selectedNodeId: '',
    activeNodeIds: [],
    hoveredTargetNodeIds: [],
    selectedTargetNodeIds: [],
  }

  let { data, selected } = $props()
  let cardEl = $state(null)
  let resizeObserver = null
  let lastSize = { width: 0, height: 0 }

  const relRows = $derived.by(() => {
    if (data?.category !== 'model') {
      return []
    }

    return (data.rels || [])
      .filter((item) => item?.rel_shape?.any !== true && item?.any !== true)
      .map((item) => ({
        ...item,
        highlight:
          item.key === edgeUi.selectedRelKey
            ? 'selected'
            : item.key === edgeUi.hoveredRelKey
              ? 'hovered'
              : null,
        meta: [
          item.kind,
          item.many ? 'many' : 'one',
          item.any ? 'any' : null,
          item.uniq ? `uniq:${item.uniq}` : null,
        ]
          .filter(Boolean)
          .join(' | '),
      }))
  })
  const isSelected = $derived(selected || data?.nodeId === edgeUi.selectedNodeId)
  const isDimmed = $derived(
    Array.isArray(edgeUi.activeNodeIds) &&
      edgeUi.activeNodeIds.length > 0 &&
      !edgeUi.activeNodeIds.includes(data?.nodeId),
  )
  const isTargeted = $derived(
    Array.isArray(edgeUi.selectedTargetNodeIds) &&
      edgeUi.selectedTargetNodeIds.includes(data?.nodeId),
  )
  const isHoveredTargeted = $derived(
    Array.isArray(edgeUi.hoveredTargetNodeIds) &&
      edgeUi.hoveredTargetNodeIds.includes(data?.nodeId),
  )

  function handleRelClick(event, rel) {
    event.stopPropagation()

    if (typeof data?.onNodeRelClick !== 'function') {
      return
    }

    data.onNodeRelClick(data.raw, rel)
  }

  function handleRelPointerOver(event, rel) {
    const currentTarget = event.currentTarget
    const relatedTarget = event.relatedTarget
    if (currentTarget instanceof Node && relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
      return
    }

    if (typeof data?.onNodeRelPointerEnter !== 'function') {
      return
    }

    data.onNodeRelPointerEnter(rel)
  }

  function handleRelPointerOut(event, rel) {
    const currentTarget = event.currentTarget
    const relatedTarget = event.relatedTarget
    if (currentTarget instanceof Node && relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
      return
    }

    if (typeof data?.onNodeRelPointerLeave !== 'function') {
      return
    }

    data.onNodeRelPointerLeave(rel)
  }

  function reportSize() {
    if (!cardEl || typeof data?.onMeasure !== 'function') {
      return
    }

    const width = Math.round(cardEl.offsetWidth)
    const height = Math.round(cardEl.offsetHeight)

    if (width === lastSize.width && height === lastSize.height) {
      return
    }

    lastSize = { width, height }
    data.onMeasure({
      id: data.nodeId,
      width,
      height,
    })
  }

  onMount(() => {
    reportSize()

    if (typeof ResizeObserver === 'undefined' || !cardEl) {
      return
    }

    resizeObserver = new ResizeObserver(() => {
      reportSize()
    })
    resizeObserver.observe(cardEl)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
  })
</script>

<div bind:this={cardEl} class:selected={isSelected} class:dimmed={isDimmed} class:targeted={isTargeted} class:hover-targeted={isHoveredTargeted} class:ghost={data?.category === 'ghost'} class="model-card">
  <Handle type="target" position={Position.Top} />

  <div class="node-head">
    <span class="kind">{data?.category || 'model'}</span>
    <strong>{data?.title}</strong>
  </div>

  {#if data?.subtitle}
    <div class="subtitle">{data.subtitle}</div>
  {/if}

  {#if data?.badges?.length}
    <div class="badges">
      {#each data.badges as badge}
        <span>{badge}</span>
      {/each}
    </div>
  {/if}

  <div class="body">
    {#if relRows.length}
      <div class="section-head">
        <span>rels</span>
        <strong>{relRows.length}</strong>
      </div>

      <ul class="rel-list">
        {#each relRows as rel}
          <li class:selected={rel.highlight === 'selected'} class:hovered={rel.highlight === 'hovered'}>
            <button class="rel-button" type="button" onclick={(event) => handleRelClick(event, rel)} onpointerover={(event) => handleRelPointerOver(event, rel)} onpointerout={(event) => handleRelPointerOut(event, rel)}>
              <div class="rel-main">
                <strong>{rel.name}</strong>
                <span>{rel.meta}</span>
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="empty-state">No rels</div>
    {/if}
  </div>

  {#if data?.attrs?.length || data?.actions?.length}
    <div class="footer">
      <span>{data?.attrs?.length || 0} attrs</span>
      <span>{data?.actions?.length || 0} actions</span>
    </div>
  {/if}

  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .model-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100%;
    min-width: 210px;
    padding: 14px 15px;
    overflow: hidden;
    border: 1px solid rgba(130, 166, 203, 0.24);
    border-radius: 18px;
    background:
      linear-gradient(135deg, rgba(13, 29, 45, 0.98), rgba(8, 16, 28, 0.96)),
      radial-gradient(circle at top left, rgba(98, 214, 163, 0.2), transparent 34%);
    color: #edf4ff;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.26);
  }

  .model-card.selected {
    border-color: rgba(245, 182, 99, 0.9);
    box-shadow:
      0 0 0 2px rgba(245, 182, 99, 0.2),
      0 20px 56px rgba(0, 0, 0, 0.34);
  }

  .model-card.dimmed {
    opacity: 0.14;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
  }

  .model-card.targeted {
    border-color: rgba(120, 168, 255, 0.96);
    box-shadow:
      0 0 0 3px rgba(120, 168, 255, 0.35),
      0 0 18px rgba(88, 150, 255, 0.45),
      0 0 44px rgba(88, 150, 255, 0.4),
      0 0 72px rgba(88, 150, 255, 0.22),
      0 20px 56px rgba(0, 0, 0, 0.34);
  }

  .model-card.hover-targeted {
    border-color: rgba(98, 214, 163, 0.94);
    box-shadow:
      0 0 0 3px rgba(98, 214, 163, 0.28),
      0 0 14px rgba(98, 214, 163, 0.34),
      0 0 36px rgba(98, 214, 163, 0.26),
      0 0 64px rgba(98, 214, 163, 0.16),
      0 20px 56px rgba(0, 0, 0, 0.34);
  }

  .model-card.ghost {
    border-style: dashed;
    background:
      linear-gradient(135deg, rgba(28, 30, 40, 0.96), rgba(12, 18, 28, 0.94)),
      radial-gradient(circle at top left, rgba(240, 111, 146, 0.18), transparent 36%);
  }

  .node-head {
    display: grid;
    gap: 5px;
  }

  .node-head strong {
    overflow: hidden;
    color: #f7fbff;
    font-size: 16px;
    line-height: 1.16;
    text-overflow: ellipsis;
  }

  .kind {
    color: #62d6a3;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .subtitle {
    overflow: hidden;
    margin-top: 8px;
    color: #95a9c1;
    font-size: 12px;
    line-height: 1.3;
    text-overflow: ellipsis;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .badges span {
    padding: 4px 7px;
    border: 1px solid rgba(149, 169, 193, 0.24);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    color: #c7d7e8;
    font-size: 10px;
  }

  .body {
    display: grid;
    flex: 1;
    min-height: 0;
    gap: 8px;
    margin-top: 10px;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #91a8c4;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .section-head strong {
    color: #c7d7e8;
    font-size: 11px;
    letter-spacing: 0;
  }

  .rel-list {
    display: grid;
    gap: 6px;
    min-height: 0;
    margin: 0;
    padding: 0 3px 0 0;
    overflow: auto;
    list-style: none;
    scrollbar-gutter: stable;
  }

  .rel-list li {
    border: 1px solid rgba(149, 169, 193, 0.16);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
  }

  .rel-list li.selected {
    border-color: rgba(120, 168, 255, 0.92);
    background: rgba(88, 150, 255, 0.16);
    box-shadow:
      0 0 0 1px rgba(120, 168, 255, 0.24) inset,
      0 0 16px rgba(88, 150, 255, 0.16);
  }

  .rel-list li.hovered {
    border-color: rgba(98, 214, 163, 0.76);
    background: rgba(98, 214, 163, 0.11);
  }

  .rel-main {
    display: grid;
    gap: 3px;
  }

  .rel-button {
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .rel-main strong {
    overflow: hidden;
    color: #f7fbff;
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
  }

  .rel-main span {
    overflow: hidden;
    color: #9fb4ca;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    display: grid;
    place-items: center;
    flex: 1;
    min-height: 0;
    border: 1px dashed rgba(149, 169, 193, 0.2);
    border-radius: 14px;
    color: #7f94ad;
    font-size: 11px;
  }

  .footer {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    color: #8fa5be;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .footer span {
    padding: 4px 7px;
    border: 1px solid rgba(149, 169, 193, 0.16);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
  }
</style>
