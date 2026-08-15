import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth, PLAN_NAMES } from '../lib/auth'
import { useAsync } from '../hooks/useAsync'
import { getProfile, saveProfile } from '../services/profileApi'
import { fetchTeams } from '../services/footballApi'
import '../styles/intel.css'
import '../styles/account.css'

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function Note({ note }) {
  if (!note) return null
  return <p className={`acct-msg ${note.tone}`}>{note.text}</p>
}

// --- Profile (display name, favourite club, FPL team id) --------------------
function ProfileSection() {
  const profileQuery = useAsync(getProfile, [])
  const teamsQuery = useAsync(fetchTeams, [])
  const profile = profileQuery.data
  const teams = teamsQuery.data?.teams ?? []

  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)

  const base = {
    displayName: profile?.displayName ?? '',
    favoriteTeam: profile?.favoriteTeam ?? '',
    fplTeamId: profile?.fplTeamId != null ? String(profile.fplTeamId) : '',
  }
  const form = draft ?? base
  const dirty = draft !== null

  const set = (key, value) => { setNote(null); setDraft((prev) => ({ ...(prev ?? base), [key]: value })) }

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setNote(null)
    try {
      await saveProfile({
        displayName: form.displayName.trim(),
        favoriteTeam: form.favoriteTeam.trim(),
        fplTeamId: form.fplTeamId.trim(),
      })
      setDraft(null)
      profileQuery.reload()
      setNote({ tone: 'good', text: 'Profile saved.' })
    } catch (err) {
      setNote({ tone: 'bad', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="acct-card" onSubmit={submit}>
      <div className="acct-card-head">
        <h2 className="acct-card-title">Profile</h2>
        <p className="acct-card-sub">Details that personalise your PitchIQ — and connect your FPL team.</p>
      </div>

      {profileQuery.status === 'loading' ? (
        <div className="intel-skeleton" aria-hidden="true"><div className="sk row" /><div className="sk row" /></div>
      ) : (
        <>
          <label className="acct-field">
            <span className="acct-field-label">Display name</span>
            <input type="text" maxLength={80} placeholder="e.g. Harsh" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
          </label>

          <label className="acct-field">
            <span className="acct-field-label">Favourite club</span>
            <select value={form.favoriteTeam} onChange={(e) => set('favoriteTeam', e.target.value)}>
              <option value="">No preference</option>
              {teams.map((team) => <option key={team.id} value={team.shortName}>{team.name}</option>)}
            </select>
          </label>

          <label className="acct-field">
            <span className="acct-field-label">FPL Team ID</span>
            <input type="text" inputMode="numeric" placeholder="e.g. 1234567" value={form.fplTeamId} onChange={(e) => set('fplTeamId', e.target.value.replace(/[^\d]/g, ''))} />
            <span className="acct-field-hint">
              Powers “My Team”. Find it in your FPL team URL: fantasy.premierleague.com/entry/<b>ID</b>/event/…
            </span>
          </label>

          <div className="acct-actions">
            <Note note={note} />
            <button type="submit" className="acct-save" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save profile'}</button>
          </div>
        </>
      )}
    </form>
  )
}

// --- Security (change password) ---------------------------------------------
function SecuritySection() {
  const { changePassword, configured } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    setNote(null)
    if (next !== confirm) { setNote({ tone: 'bad', text: 'The new passwords do not match.' }); return }
    setSaving(true)
    try {
      await changePassword(current, next)
      setCurrent(''); setNext(''); setConfirm('')
      setNote({ tone: 'good', text: 'Password updated. Use it next time you sign in.' })
    } catch (err) {
      setNote({ tone: 'bad', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="acct-card" onSubmit={submit}>
      <div className="acct-card-head">
        <h2 className="acct-card-title">Password</h2>
        <p className="acct-card-sub">Change the password you use to sign in.</p>
      </div>

      {!configured ? (
        <p className="acct-msg muted">Password changes need a live account (Supabase). Not available in demo mode.</p>
      ) : (
        <>
          <label className="acct-field">
            <span className="acct-field-label">Current password</span>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label className="acct-field">
            <span className="acct-field-label">New password</span>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
            <span className="acct-field-hint">At least 6 characters.</span>
          </label>
          <label className="acct-field">
            <span className="acct-field-label">Confirm new password</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>

          <div className="acct-actions">
            <Note note={note} />
            <button type="submit" className="acct-save" disabled={saving || !current || !next}>{saving ? 'Updating…' : 'Update password'}</button>
          </div>
        </>
      )}
    </form>
  )
}

export function AccountPage() {
  const { user, plan, signOut } = useAuth()
  const memberSince = formatDate(user?.createdAt)
  const isFree = plan === 'free'

  return (
    <div className="acct-shell">
      <div className="intel acct-page">
        <header className="acct-page-head">
          <div>
            <p className="intel-eyebrow">Account</p>
            <h1 className="intel-title">Your account</h1>
            <p className="intel-sub">Manage your profile, connected team and password.</p>
          </div>
          <Link className="acct-back" to="/app">← Back to app</Link>
        </header>

        <section className="acct-card acct-overview">
          <div className="acct-ov-row">
            <span className="acct-ov-label">Email</span>
            <span className="acct-ov-value">{user?.email ?? '—'}</span>
          </div>
          <div className="acct-ov-row">
            <span className="acct-ov-label">Plan</span>
            <span className="acct-ov-value">
              <span className={`acct-plan-chip ${plan}`}>{PLAN_NAMES[plan]}</span>
              {isFree && <Link className="acct-upgrade-link" to="/pricing">Upgrade to Pro →</Link>}
            </span>
          </div>
          {memberSince && (
            <div className="acct-ov-row">
              <span className="acct-ov-label">Member since</span>
              <span className="acct-ov-value">{memberSince}</span>
            </div>
          )}
        </section>

        <ProfileSection />
        <SecuritySection />

        <div className="acct-signout-row">
          <button type="button" className="acct-signout-btn" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
