import { One } from './One'

export const Path = ({
  rels,
  children,
  fallback = null,
}: {
  rels: readonly string[]
  children: React.ReactNode
  fallback?: React.ReactNode
}) => {
  if (!rels.length) {
    return <>{children}</>
  }

  const [head, ...tail] = rels

  return (
    <One rel={head} fallback={fallback}>
      <Path rels={tail} fallback={fallback}>
        {children}
      </Path>
    </One>
  )
}