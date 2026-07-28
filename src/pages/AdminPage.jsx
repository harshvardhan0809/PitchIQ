import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAsync } from '../hooks/useAsync'
import { PLAN_LABELS } from '../lib/plan'
import { useAuth, setLocalPlan } from '../lib/auth'
import { fetchAdminUsers, setUserPlan } from '../services/adminApi'
import '../styles/intel.css'
import '../styles/admin.css'

const PLANS = ['free', 'pro']

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function PlanSwitch({ user, saving, onChange }) {
  return (
    <div className="admin-switch" role="group" aria-label={`Subscription for ${user.email}`}>
      {PLANS.map((plan) => (
        <button
          key={plan}
          type="button"
          className={`admin-switch-btn ${user.plan === plan ? `active ${plan}` : ''}`}
          aria-pressed={user.plan === plan}
          disabled={saving}
          onClick={() => onChange(user, plan)}
        >
          {PLAN_LABELS[plan]}
        </button>
      ))}
    </div>
  )
}

export function AdminPage() {
  const { user: currentUser } = useAuth()
  const { status, data, error, reload } = useAsync(fetchAdminUsers, [])
  // Local plan changes are held as an overrides map layered over the fetched
  // list, so a change shows immediately without copying the server data into
  // state (which would fight the next refetch).
  const [overrides, setOverrides] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [rowNote, setRowNote] = useState(null) // { id, tone, text }

  const rows = data?.users?.map((user) => (
    overrides[user.id] ? { ...user, plan: overrides[user.id] } : user
  )) ?? null

  async function changePlan(user, plan) {
    if (plan === user.plan || savingId) return
    setSavingId(user.id)
    setRowNote(null)
    try {
      const result = await setUserPlan(user.id, plan)
      setOverrides((prev) => ({ ...prev, [user.id]: result.plan }))
      // If we changed our own plan, update the local value so our gated views
      // re-render. No token refresh needed — the server reads the plan live.
      if (currentUser && user.id === currentUser.id) setLocalPlan(result.plan)
      // Confirm it actually persisted rather than trusting an optimistic value.
      const confirmed = await fetchAdminUsers()
      const fresh = confirmed.users.find((row) => row.id === user.id)
      setOverrides((prev) => ({ ...prev, [user.id]: fresh?.plan ?? result.plan }))
      setRowNote({
        id: user.id,
        tone: fresh?.plan === plan ? 'good' : 'bad',
        text: fresh?.plan === plan
          ? `Saved — now on ${PLAN_LABELS[fresh.plan]}.`
          : `Did not persist (still ${PLAN_LABELS[fresh?.plan ?? 'free']}). Is the API running the latest code?`,
      })
    } catch (err) {
      setRowNote({ id: user.id, tone: 'bad', text: err.message })
    } finally {
      setSavingId(null)
    }
  }

  function refresh() {
    setOverrides({})
    setRowNote(null)
    reload()
  }

  const counts = (rows ?? []).reduce((acc, row) => { acc[row.plan] = (acc[row.plan] ?? 0) + 1; return acc }, {})

  return (
    <div className="admin-shell">
      <div className="intel admin">
        <header className="admin-head">
          <div>
            <p className="intel-eyebrow">Admin</p>
            <h1 className="intel-title">Users &amp; subscriptions</h1>
            <p className="intel-sub">Every registered account. Change any subscription with the switch — it writes to the account immediately.</p>
          </div>
          <Link className="admin-back" to="/app">← Back to app</Link>
        </header>

        {status === 'loading' && (
          <div className="intel-skeleton" aria-hidden="true">
            <div className="sk hero" />
            {[0, 1, 2].map((index) => <div className="sk row" key={index} />)}
          </div>
        )}

        {status === 'error' && (
          <div className="intel-error">
            <p>
              {error?.status === 403
                ? 'Your account does not have admin access.'
                : error?.status === 401
                  ? 'Please sign in to view the admin console.'
                  : error?.message ?? 'Could not load users.'}
            </p>
            {error?.status !== 403 && <button type="button" onClick={reload}>Try again</button>}
          </div>
        )}

        {status === 'ready' && rows && (
          <>
            <div className="admin-stats">
              <span className="admin-stat"><b>{rows.length}</b> total</span>
              <span className="admin-stat"><b>{counts.free ?? 0}</b> Free</span>
              <span className="admin-stat pro"><b>{counts.pro ?? 0}</b> Pro</span>
              <button type="button" className="admin-refresh" onClick={refresh}>Refresh</button>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Last seen</th>
                    <th className="admin-th-plan">Subscription</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((user) => (
                    <tr key={user.id} className={savingId === user.id ? 'is-saving' : ''}>
                      <td>
                        <div className="admin-user">
                          <span className="admin-email">{user.email ?? '—'}</span>
                          <span className={`admin-plan-tag ${user.plan}`}>{PLAN_LABELS[user.plan]}</span>
                        </div>
                        {rowNote?.id === user.id && (
                          <p className={`admin-row-note ${rowNote.tone}`}>{rowNote.text}</p>
                        )}
                      </td>
                      <td>
                        <span className={`admin-dot ${user.confirmed ? 'ok' : 'pending'}`} />
                        {user.confirmed ? 'Confirmed' : 'Unconfirmed'}
                      </td>
                      <td className="admin-num">{formatDate(user.createdAt)}</td>
                      <td className="admin-num">{formatDate(user.lastSignInAt)}</td>
                      <td>
                        <PlanSwitch user={user} saving={savingId === user.id} onChange={changePlan} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
