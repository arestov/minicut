<script>
  import { BaseEdge, getSmoothStepPath } from '@xyflow/svelte'
  import { getContext } from 'svelte'
  import { EDGE_UI_CONTEXT } from '../graph/edgeUiContext.js'

  const edgeUi = getContext(EDGE_UI_CONTEXT) ?? {
    hoveredRelKey: '',
    selectedRelKey: '',
    activeEdgeIds: [],
  }

  let {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    label,
    markerEnd,
    selected,
    style,
    data,
  } = $props()

  let hovered = $state(false)

  const routedPath = $derived.by(() => {
    const route = data?.route
    if (!Array.isArray(route) || route.length < 2) {
      return null
    }

    return route
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ')
  })

  const fallbackPath = $derived(
    getSmoothStepPath({ sourceX, sourceY, targetX, targetY })[0],
  )
  const path = $derived(routedPath || fallbackPath)
  const relKey = $derived(data?.relKey || '')
  const isDimmed = $derived(
    Array.isArray(edgeUi.activeEdgeIds) &&
      edgeUi.activeEdgeIds.length > 0 &&
      !edgeUi.activeEdgeIds.includes(id),
  )
  const isHoveredGroup = $derived(relKey !== '' && relKey === edgeUi.hoveredRelKey)
  const isHovered = $derived(hovered || isHoveredGroup)
  const isSelected = $derived(
    selected || (relKey !== '' && relKey === edgeUi.selectedRelKey),
  )
  const labelPoint = $derived.by(() => {
    const route = data?.route
    if (Array.isArray(route) && route.length) {
      return route[Math.floor(route.length / 2)]
    }

    return {
      x: (sourceX + targetX) / 2,
      y: (sourceY + targetY) / 2,
    }
  })

  const edgeStyle = $derived.by(() => ({
    ...(style || {}),
    ...(isDimmed
      ? {
          opacity: 0.08,
          pointerEvents: 'none',
        }
      : isSelected
        ? {
            strokeWidth: 3.4,
          }
        : isHovered
          ? {
              opacity: 0.95,
            }
          : {}),
  }))

  const edgeClass = $derived.by(() =>
    isDimmed ? 'edge-dimmed' : isHovered ? 'edge-hovered' : isSelected ? 'edge-selected' : '',
  )

  function handlePointerEnter() {
    hovered = true
  }

  function handlePointerLeave() {
    hovered = false
  }
</script>

<BaseEdge
  {id}
  {path}
  {markerEnd}
  class={edgeClass}
  style={edgeStyle}
  onpointerenter={handlePointerEnter}
  onpointerleave={handlePointerLeave}
/>

{#if label && !isDimmed}
  <g class={`edge-label ${isHovered ? 'is-hovered' : isSelected ? 'is-selected' : ''}`} transform={`translate(${labelPoint.x}, ${labelPoint.y})`}>
    <rect x="-86" y="-12" width="172" height="24" rx="12" />
    <text text-anchor="middle" dominant-baseline="middle">{label}</text>
  </g>
{/if}

<style>
  .edge-label {
    pointer-events: none;
  }

  .edge-label rect {
    fill: rgba(150, 150, 150, 0.72);
    stroke: rgba(76, 76, 76, 0.5);
  }

  .edge-label.is-hovered rect {
    fill: rgba(158, 158, 158, 0.78);
    stroke: rgba(70, 70, 70, 0.56);
  }

  .edge-label.is-selected rect {
    fill: rgba(166, 166, 166, 0.82);
    stroke: rgba(54, 54, 54, 0.62);
  }

  .edge-label text {
    fill: #111111;
    font-size: 11px;
    font-weight: 700;
  }

  .edge-label.is-hovered text {
    fill: #0b0b0b;
  }

  .edge-label.is-selected text {
    fill: #060606;
  }

  :global(.edge-hovered) {
    filter:
      drop-shadow(0 0 2px rgba(98, 214, 163, 0.95))
      drop-shadow(0 0 4px rgba(98, 214, 163, 0.9))
      drop-shadow(0 0 8px rgba(98, 214, 163, 0.72))
      drop-shadow(0 0 14px rgba(98, 214, 163, 0.5));
  }

  :global(.edge-selected) {
    filter:
      drop-shadow(0 0 2px rgba(88, 150, 255, 0.95))
      drop-shadow(0 0 4px rgba(88, 150, 255, 0.9))
      drop-shadow(0 0 8px rgba(88, 150, 255, 0.72))
      drop-shadow(0 0 14px rgba(88, 150, 255, 0.5));
  }
</style>
