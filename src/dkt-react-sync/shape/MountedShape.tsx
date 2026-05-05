import type { ReactNode } from 'react'
import { useShape } from '../hooks/useShape'
import type { DefinedReactShape } from './defineShape'

export const MountedShape = ({
  shape,
  children,
}: {
  shape: DefinedReactShape
  children: ReactNode
}) => {
  useShape(shape)

  return <>{children}</>
}