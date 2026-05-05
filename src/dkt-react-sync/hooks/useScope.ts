import { useContext } from 'react'
import { ScopeContext } from '../context/ScopeContext'

export const useScope = () => {
  return useContext(ScopeContext)
}