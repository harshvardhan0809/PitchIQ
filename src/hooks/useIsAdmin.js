import { useEffect, useState } from 'react'

import { useAuth } from '../lib/auth'
import { usesLiveData } from '../services/footballApi'
import { fetchMe } from '../services/adminApi'

/**
 * Whether the signed-in user is an admin, per the server. Drives both the nav
 * link and the /admin route guard — the admin endpoints enforce access on their
 * own too, so a wrong answer here can never grant privilege.
 *
 * Returns `false` when definitively not an admin (signed out, demo mode),
 * `null` while the answer is still being verified for the current user, and a
 * boolean once known. The result is keyed to the user id so a cached answer from
 * a previous account can never momentarily leak the admin page to the next one.
 */
export function useIsAdmin() {
  const { signedIn, user } = useAuth()
  const userId = user?.id ?? null
  const [result, setResult] = useState({ userId: null, isAdmin: false })

  useEffect(() => {
    if (!signedIn || !usesLiveData || !userId) return undefined
    let active = true
    fetchMe()
      .then((me) => { if (active) setResult({ userId, isAdmin: Boolean(me?.isAdmin) }) })
      .catch(() => { if (active) setResult({ userId, isAdmin: false }) })
    return () => { active = false }
  }, [signedIn, userId])

  if (!signedIn || !usesLiveData) return false
  if (result.userId !== userId) return null // still verifying for this user
  return result.isAdmin
}
