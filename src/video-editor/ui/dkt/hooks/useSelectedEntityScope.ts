import { SESSION_SCOPE, useEditorOne } from '../../../render-sync'

export const useSelectedEntityScope = () => useEditorOne('selectedEntity', SESSION_SCOPE)
