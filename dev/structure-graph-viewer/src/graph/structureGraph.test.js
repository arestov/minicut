import { describe, expect, it } from 'vitest'

import { buildFlowGraph, rootModelOption } from './structureGraph.js'

function model(id, modelName, rels = [], isRoot = false) {
  return {
    id,
    model_name: modelName,
    attrs: [],
    rels,
    actions: [],
    meta: { is_root: isRoot },
  }
}

function rel(name, kind, linking) {
  return {
    name,
    kind,
    many: false,
    any: false,
    linking,
    child_model_refs: [],
  }
}

const root = { model_name: 'app_root', hierarchy_num: 0 }

const coreSnapshot = {
  kind: 'core',
  root,
  models: [
    model(
      0,
      'app_root',
      [
        rel('project', 'input', {
          type: 'model_constructor',
          value: { type: 'model_ref', model_name: 'project' },
        }),
      ],
      true,
    ),
    model(1, 'project', [
      rel('tracks', 'input', {
        type: 'addr',
        value: '<< @one:$root.track <<',
      }),
    ]),
    model(2, 'track'),
  ],
}

const derivedSnapshot = {
  kind: 'derived',
  root,
  models: [
    model(
      0,
      'app_root',
      [rel('track', 'comp', { type: 'model_name', value: 'track' })],
      true,
    ),
    model(1, 'project'),
    model(2, 'track'),
  ],
}

const layers = {
  hierarchy: false,
  rel_schema: true,
  derived_rel: true,
  attr_dep: false,
  unknown_targets: false,
}

describe('structure graph model registry links', () => {
  it('selects an app root declared through model_name', () => {
    expect(rootModelOption(coreSnapshot)).toMatchObject({
      id: '0',
      label: 'app_root',
    })
  })

  it('resolves model_constructor, model_name, and cross-slice rel paths', async () => {
    const coreGraph = await buildFlowGraph(coreSnapshot, {
      selectedModelId: '0',
      showInfra: true,
      resolverSnapshots: [derivedSnapshot],
      layers,
    })
    const derivedGraph = await buildFlowGraph(derivedSnapshot, {
      selectedModelId: '0',
      showInfra: true,
      resolverSnapshots: [coreSnapshot],
      layers,
    })

    expect(coreGraph.edges.map((edge) => edge.id)).toEqual(
      expect.arrayContaining([
        'rel:model:0:project:model:1',
        'rel:model:1:tracks:model:2',
      ]),
    )
    expect(derivedGraph.edges.map((edge) => edge.id)).toContain(
      'rel:model:0:track:model:2',
    )
  })
})
