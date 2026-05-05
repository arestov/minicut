import { ROOT_SCOPE, useEditorOne } from '../../../render-sync'

export const useActiveProjectScope = () => useEditorOne('activeProject', ROOT_SCOPE)
