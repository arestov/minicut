const miniActionFlowSnapshot = {
  models: [
    {
      id: 1,
      model_name: 'project',
      rels: [
        {
          name: 'activeTrack',
          child_model_refs: [{ model_name: 'track' }],
        },
      ],
    },
    {
      id: 2,
      model_name: 'track',
      rels: [
        {
          name: 'clips',
          child_model_refs: [{ model_name: 'clip' }],
        },
      ],
    },
    {
      id: 3,
      model_name: 'clip',
      rels: [
        {
          name: 'project',
          child_model_refs: [{ model_name: 'project' }],
        },
        {
          name: 'track',
          child_model_refs: [{ model_name: 'track' }],
        },
        {
          name: 'resource',
          child_model_refs: [{ model_name: 'resource' }],
        },
        {
          name: 'text',
          child_model_refs: [{ model_name: 'text' }],
        },
      ],
    },
    {
      id: 4,
      model_name: 'resource',
      rels: [],
    },
    {
      id: 5,
      model_name: 'text',
      rels: [],
    },
  ],
  action_flows: [
    {
      id: 'clip.splitSelfAt',
      model_name: 'clip',
      steps: [
        {
          deps: ['self.project', 'self.resource', 'self.text'],
          writes: [
            {
              kind: 'create',
              model_name: 'clip',
              creation_shape: {
                rels: {
                  track: 'same track',
                  resource: 'same resource',
                  text: 'same text',
                },
              },
            },
          ],
          subflows: [
            {
              path: 'self.project.activeTrack',
              model_name: 'track',
              flow_id: 'track.splitClipAt',
            },
          ],
        },
      ],
      transitive_subflows: [
        {
          id: 'track.splitClipAt',
          model_name: 'track',
        },
      ],
      derived_affects: [],
    },
    {
      id: 'track.splitClipAt',
      model_name: 'track',
      steps: [
        {
          deps: ['self.clips'],
          writes: [
            {
              kind: 'rel',
              model_name: 'track',
              name: 'clips',
            },
          ],
          subflows: [],
        },
      ],
      transitive_subflows: [],
      derived_affects: [],
    },
  ],
}

export { miniActionFlowSnapshot }
