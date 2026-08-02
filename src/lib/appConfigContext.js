import { createContext, useContext } from 'react'

import { DEFAULT_CONFIG } from '../services/configApi'

/**
 * App-wide configuration, provided once near the top of the product tree and
 * read by the Pro ad, the announcement banner and the feature navigation. Split
 * from the provider component so the hook can be imported without tripping the
 * react-refresh "only export components" rule.
 */
export const AppConfigContext = createContext(DEFAULT_CONFIG)

export function useAppConfig() {
  return useContext(AppConfigContext)
}
