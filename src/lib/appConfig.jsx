import { useEffect, useState } from 'react'

import { DEFAULT_CONFIG, fetchAppConfig } from '../services/configApi'
import { AppConfigContext } from './appConfigContext'

/**
 * Fetches the public app config once on mount and makes it available to the whole
 * product tree. It starts from defaults so the first paint is never blocked, then
 * swaps in the live values when they arrive.
 */
export function AppConfigProvider({ children }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG)

  useEffect(() => {
    let active = true
    fetchAppConfig().then((value) => { if (active) setConfig(value) })
    return () => { active = false }
  }, [])

  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>
}
