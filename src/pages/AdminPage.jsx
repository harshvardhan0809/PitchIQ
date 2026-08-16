import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAsync } from '../hooks/useAsync'
import { PLAN_LABELS } from '../lib/plan'
import { useAuth, setLocalPlan } from '../lib/auth'
import { fetchAdminUsers, setUserPlan, fetchAdminSettings, saveAdminSettings } from '../services/adminApi'
import { fetchManager } from '../services/intelligenceApi'
import '../styles/intel.css'
import '../styles/admin.css'

const PLANS = ['free', 'pro']

// The premium tiles an admin can hide from the app navigation, with the labels
// used across the product so the console reads the same as the app.
const FEATURE_TILES = [
  { id: 'matchxg', label: 'Match xG', icon: '🥅' },
  { id: 'expert', label: 'Expert View', icon: '📰' },
  { id: 'squad', label: 'My Team', icon: '🧩' },
  { id: 'captain', label: 'Captain AI', icon: '🧠' },
  { id: 'briefing', label: 'Weekly Briefing', icon: '📅' },
  { id: 'prices', label: 'Price Watch', icon: '💰' },
  { id: 'league', label: 'War Room', icon: '⚔️' },
  { id: 'manager', label: 'Manager Mindset', icon: '🎯' },
  { id: 'differentials', label: 'Differentials', icon: '💎' },
]

const TONES = [
  { id: 'info', label: 'Info' },
  { id: 'success', label: 'Success' },
  { id: 'warning', label: 'Warning' },
]

const TABS = [
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'ads', label: 'Pro ad', icon: '📣' },
  { id: 'site', label: 'Site', icon: '🎛️' },
  { id: 'expert', label: 'Expert', icon: '📰' },
  { id: 'system', label: 'System', icon: '🩺' },
]

// A plainly-public https URL check, mirroring the server's SSRF guard so the
// console can flag a bad source row before it's ever saved.
function isPublicHttps(value) {
  try {
    const url = new URL(String(value).trim())
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(host)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
    return true
  } catch {
    return false
  }
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const round1 = (n) => Math.round(n * 10) / 10

// --- small form primitives --------------------------------------------------

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`admin-toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-toggle-track"><span className="admin-toggle-knob" /></span>
      {label && <span className="admin-toggle-label">{label}</span>}
    </button>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      {children}
      {hint && <span className="admin-field-hint">{hint}</span>}
    </label>
  )
}

// --- Users tab (subscriptions) ----------------------------------------------

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

function UsersTab() {
  const { user: currentUser } = useAuth()
  const { status, data, error, reload } = useAsync(fetchAdminUsers, [])
  const [overrides, setOverrides] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [rowNote, setRowNote] = useState(null)

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
      if (currentUser && user.id === currentUser.id) setLocalPlan(result.plan)
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

  if (status === 'loading') {
    return (
      <div className="intel-skeleton" aria-hidden="true">
        <div className="sk hero" />
        {[0, 1, 2].map((index) => <div className="sk row" key={index} />)}
      </div>
    )
  }

  if (status === 'error') {
    return (
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
    )
  }

  if (!rows) return null

  return (
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
  )
}

// --- Settings tabs (Ads + Site), sharing one draft ---------------------------

function useSettingsForm() {
  const query = useAsync(fetchAdminSettings, [])
  const settings = query.data?.settings ?? null
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null) // { tone, text }

  const form = draft ?? settings
  const dirty = draft !== null

  function patchSection(section, key, value) {
    setNote(null)
    setDraft((prev) => {
      const base = prev ?? settings
      return { ...base, [section]: { ...base[section], [key]: value } }
    })
  }
  function patchTop(key, value) {
    setNote(null)
    setDraft((prev) => ({ ...(prev ?? settings), [key]: value }))
  }

  async function save() {
    if (!form || saving) return
    setSaving(true)
    setNote(null)
    try {
      const result = await saveAdminSettings(form)
      setDraft(null)
      query.reload()
      setNote({
        tone: result.persisted ? 'good' : 'warn',
        text: result.persisted
          ? 'Saved. Changes are live for everyone.'
          : 'Saved in memory for this server only — run the app_settings migration in Supabase to make it stick.',
      })
    } catch (err) {
      setNote({ tone: 'bad', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    setDraft(null)
    setNote(null)
  }

  return { query, settings, form, dirty, saving, note, patchSection, patchTop, save, discard }
}

function SaveBar({ dirty, saving, note, onSave, onDiscard }) {
  return (
    <div className="admin-savebar">
      {note && <span className={`admin-savenote ${note.tone}`}>{note.text}</span>}
      {dirty && !note && <span className="admin-savenote muted">Unsaved changes</span>}
      <div className="admin-savebar-actions">
        {dirty && <button type="button" className="admin-ghost" onClick={onDiscard} disabled={saving}>Discard</button>}
        <button type="button" className="admin-primary" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function AdsTab({ ctl }) {
  const { form, patchSection } = ctl
  if (!form) return null
  const ads = form.ads

  return (
    <div className="admin-panels">
      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Pro upsell ad</h2>
            <p className="admin-card-sub">The prompt free users see while they browse. Pro users never see it.</p>
          </div>
          <Toggle checked={ads.enabled} onChange={(v) => patchSection('ads', 'enabled', v)} label={ads.enabled ? 'On' : 'Off'} />
        </div>

        <div className={`admin-grid ${ads.enabled ? '' : 'is-disabled'}`}>
          <Field label="First ad after" hint="Seconds from opening the app (3–120).">
            <div className="admin-input-suffix">
              <input
                type="number" min="3" max="120" value={ads.firstDelaySec}
                onChange={(e) => patchSection('ads', 'firstDelaySec', Number(e.target.value))}
              />
              <span>sec</span>
            </div>
          </Field>
          <Field label="Repeat every — from" hint="Minutes between repeats (lower bound).">
            <div className="admin-input-suffix">
              <input
                type="number" min="0.5" step="0.5" value={round1(ads.minIntervalSec / 60)}
                onChange={(e) => patchSection('ads', 'minIntervalSec', Math.round(Number(e.target.value) * 60))}
              />
              <span>min</span>
            </div>
          </Field>
          <Field label="…up to" hint="Upper bound. A random gap in this window is picked each time.">
            <div className="admin-input-suffix">
              <input
                type="number" min="0.5" step="0.5" value={round1(ads.maxIntervalSec / 60)}
                onChange={(e) => patchSection('ads', 'maxIntervalSec', Math.round(Number(e.target.value) * 60))}
              />
              <span>min</span>
            </div>
          </Field>
        </div>

        <div className={`admin-stack ${ads.enabled ? '' : 'is-disabled'}`}>
          <Field label="Headline" hint={`${ads.headline.length}/90`}>
            <input type="text" maxLength={90} value={ads.headline} onChange={(e) => patchSection('ads', 'headline', e.target.value)} />
          </Field>
          <Field label="Body" hint={`${ads.subtext.length}/240`}>
            <textarea rows={3} maxLength={240} value={ads.subtext} onChange={(e) => patchSection('ads', 'subtext', e.target.value)} />
          </Field>
          <Field label="Button label" hint={`${ads.ctaLabel.length}/40`}>
            <input type="text" maxLength={40} value={ads.ctaLabel} onChange={(e) => patchSection('ads', 'ctaLabel', e.target.value)} />
          </Field>
        </div>
      </section>

      <aside className="admin-card admin-preview">
        <h2 className="admin-card-title">Live preview</h2>
        <div className="admin-ad-preview">
          <span className="pro-ad-badge">PitchIQ Pro</span>
          <h3 className="pro-ad-title">{ads.headline || 'Headline'}</h3>
          <p className="pro-ad-sub">{ads.subtext || 'Body copy…'}</p>
          <span className="admin-ad-cta">{ads.ctaLabel || 'Upgrade to Pro →'}</span>
        </div>
        <p className="admin-preview-note">
          Shows {ads.firstDelaySec}s after opening, then every {round1(ads.minIntervalSec / 60)}–{round1(ads.maxIntervalSec / 60)} min.
        </p>
      </aside>
    </div>
  )
}

function SiteTab({ ctl, teams }) {
  const { form, patchSection, patchTop } = ctl
  if (!form) return null
  const ann = form.announcement

  return (
    <div className="admin-panels">
      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Announcement banner</h2>
            <p className="admin-card-sub">A strip across the top of the app for every user.</p>
          </div>
          <Toggle checked={ann.enabled} onChange={(v) => patchSection('announcement', 'enabled', v)} label={ann.enabled ? 'On' : 'Off'} />
        </div>
        <div className={`admin-stack ${ann.enabled ? '' : 'is-disabled'}`}>
          <Field label="Message" hint={`${ann.text.length}/200`}>
            <input type="text" maxLength={200} placeholder="e.g. New: Manager Mindset is live!" value={ann.text} onChange={(e) => patchSection('announcement', 'text', e.target.value)} />
          </Field>
          <Field label="Tone">
            <div className="admin-segmented">
              {TONES.map((tone) => (
                <button
                  key={tone.id}
                  type="button"
                  className={`admin-seg ${ann.tone === tone.id ? 'active' : ''} tone-${tone.id}`}
                  onClick={() => patchSection('announcement', 'tone', tone.id)}
                >
                  {tone.label}
                </button>
              ))}
            </div>
          </Field>
          {ann.text.trim() && (
            <div className={`admin-note-preview tone-${ann.tone}`}>
              <span aria-hidden="true">📣</span>
              <span className="admin-note-preview-text">{ann.text}</span>
            </div>
          )}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Feature visibility</h2>
            <p className="admin-card-sub">Hide any premium tile from the app navigation. Matchday always stays on.</p>
          </div>
        </div>
        <div className="admin-tiles">
          {FEATURE_TILES.map((tile) => {
            const on = form.features[tile.id] !== false
            return (
              <div key={tile.id} className={`admin-tile ${on ? 'on' : 'off'}`}>
                <span className="admin-tile-ic" aria-hidden="true">{tile.icon}</span>
                <span className="admin-tile-label">{tile.label}</span>
                <Toggle checked={on} onChange={(v) => patchSection('features', tile.id, v)} />
              </div>
            )
          })}
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Manager Mindset</h2>
            <p className="admin-card-sub">The club the analyser opens on before anyone picks a team.</p>
          </div>
        </div>
        <Field label="Default club">
          <select value={form.managerDefaultTeam} onChange={(e) => patchTop('managerDefaultTeam', e.target.value)}>
            {(teams ?? []).length === 0 && <option value={form.managerDefaultTeam}>{form.managerDefaultTeam}</option>}
            {(teams ?? []).map((team) => (
              <option key={team.id} value={team.shortName}>{team.name}</option>
            ))}
          </select>
        </Field>
      </section>
    </div>
  )
}

function ExpertTab({ ctl }) {
  const { form, patchSection } = ctl
  if (!form) return null
  const expert = form.expert ?? { enabled: true, sources: [] }
  const sources = expert.sources ?? []

  function setSources(next) {
    patchSection('expert', 'sources', next)
  }
  function updateSource(index, key, value) {
    setSources(sources.map((src, i) => (i === index ? { ...src, [key]: value } : src)))
  }
  function addSource() {
    if (sources.length >= 12) return
    setSources([...sources, { name: '', url: '' }])
  }
  function removeSource(index) {
    setSources(sources.filter((_, i) => i !== index))
  }

  return (
    <div className="admin-panels">
      <section className="admin-card">
        <div className="admin-card-head">
          <div>
            <h2 className="admin-card-title">Expert View feed</h2>
            <p className="admin-card-sub">
              A curated stream of real FPL-community writing, pulled from the RSS/Atom sources below and shown to
              everyone. No content is stored — the app just links out to each article.
            </p>
          </div>
          <Toggle checked={expert.enabled} onChange={(v) => patchSection('expert', 'enabled', v)} label={expert.enabled ? 'On' : 'Off'} />
        </div>

        <div className={`admin-stack ${expert.enabled ? '' : 'is-disabled'}`}>
          <div className="admin-sources">
            {sources.length === 0 && (
              <p className="admin-field-hint">No sources yet. Add a public feed URL to populate the Expert View.</p>
            )}
            {sources.map((src, index) => {
              const badUrl = src.url.trim() !== '' && !isPublicHttps(src.url)
              return (
                <div className="admin-source-row" key={index}>
                  <input
                    className="admin-source-name"
                    type="text" maxLength={60} placeholder="Source name"
                    value={src.name}
                    onChange={(e) => updateSource(index, 'name', e.target.value)}
                  />
                  <input
                    className={`admin-source-url ${badUrl ? 'is-invalid' : ''}`}
                    type="url" inputMode="url" placeholder="https://example.com/feed/"
                    value={src.url}
                    onChange={(e) => updateSource(index, 'url', e.target.value)}
                  />
                  <button type="button" className="admin-source-del" onClick={() => removeSource(index)} aria-label="Remove source">✕</button>
                  {badUrl && <span className="admin-source-warn">Must be a public https feed URL.</span>}
                </div>
              )
            })}
          </div>
          <button type="button" className="admin-ghost admin-add-source" onClick={addSource} disabled={sources.length >= 12}>
            + Add source{sources.length >= 12 ? ' (max 12)' : ''}
          </button>
          <p className="admin-field-hint">
            Point these at a site&apos;s RSS/Atom feed — often the homepage URL with <code>/feed/</code> or <code>.rss</code>
            appended. Invalid or unreachable feeds are skipped automatically; the feed refreshes about every 10 minutes.
          </p>
        </div>
      </section>
    </div>
  )
}

function SystemTab({ diagnostics }) {
  if (!diagnostics) return null
  const d = diagnostics
  const items = [
    { label: 'Server build', value: d.serverBuild, tone: 'neutral' },
    { label: 'Settings persistence', value: d.settingsPersisted ? 'Supabase (durable)' : 'In-memory only', tone: d.settingsPersisted ? 'good' : 'warn' },
    { label: 'Supabase identity', value: d.supabaseConfigured ? 'Configured' : 'Missing', tone: d.supabaseConfigured ? 'good' : 'bad' },
    { label: 'Service role (manage users)', value: d.supabaseManage ? 'Enabled' : 'Missing', tone: d.supabaseManage ? 'good' : 'bad' },
    { label: 'Razorpay billing', value: d.billingConfigured ? 'Configured' : 'Not configured', tone: d.billingConfigured ? 'good' : 'warn' },
    { label: 'Admin accounts', value: String(d.adminEmails), tone: 'neutral' },
    { label: 'Live data', value: d.liveData ? 'Yes' : 'Demo', tone: d.liveData ? 'good' : 'warn' },
    { label: 'Cache entries', value: String(d.cacheEntries), tone: 'neutral' },
  ]
  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <div>
          <h2 className="admin-card-title">System status</h2>
          <p className="admin-card-sub">A read-only snapshot of what this server sees. Nothing here is a secret value.</p>
        </div>
      </div>
      <dl className="admin-diag">
        {items.map((item) => (
          <div key={item.label} className="admin-diag-row">
            <dt>{item.label}</dt>
            <dd><span className={`admin-badge ${item.tone}`}>{item.value}</span></dd>
          </div>
        ))}
      </dl>
      {!diagnostics.settingsPersisted && (
        <p className="admin-diag-hint">
          Settings changes won&apos;t survive a restart until the <code>app_settings</code> table exists — run
          <code> supabase/schema.sql</code> in the Supabase SQL editor.
        </p>
      )}
    </section>
  )
}

export function AdminPage() {
  const [tab, setTab] = useState('users')
  const ctl = useSettingsForm()
  // The club list for the Manager default picker (teams survive gating).
  const teamsQuery = useAsync(fetchManager, [''])
  const teams = teamsQuery.data?.teams ?? null

  const settingsBusy = ctl.query.status === 'loading'
  const settingsError = ctl.query.status === 'error' ? ctl.query.error : null

  return (
    <div className="admin-shell">
      <div className="intel admin">
        <header className="admin-head">
          <div>
            <p className="intel-eyebrow">Admin console</p>
            <h1 className="intel-title">PitchIQ control</h1>
            <p className="intel-sub">Manage subscriptions and tune the live app — ads, announcements, features and defaults.</p>
          </div>
          <Link className="admin-back" to="/app">← Back to app</Link>
        </header>

        <nav className="admin-tabs" aria-label="Admin sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`admin-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <span aria-hidden="true">{item.icon}</span> {item.label}
            </button>
          ))}
        </nav>

        {tab === 'users' && <UsersTab />}

        {(tab === 'ads' || tab === 'site' || tab === 'expert' || tab === 'system') && (
          <>
            {settingsBusy && (
              <div className="intel-skeleton" aria-hidden="true">
                <div className="sk hero" />
                {[0, 1].map((index) => <div className="sk row" key={index} />)}
              </div>
            )}
            {settingsError && (
              <div className="intel-error">
                <p>
                  {settingsError.status === 403
                    ? 'Your account does not have admin access.'
                    : settingsError.status === 401
                      ? 'Please sign in to manage settings.'
                      : settingsError.message ?? 'Could not load settings.'}
                </p>
                {settingsError.status !== 403 && <button type="button" onClick={ctl.query.reload}>Try again</button>}
              </div>
            )}
            {ctl.query.status === 'ready' && (
              <>
                {tab === 'ads' && <AdsTab ctl={ctl} />}
                {tab === 'site' && <SiteTab ctl={ctl} teams={teams} />}
                {tab === 'expert' && <ExpertTab ctl={ctl} />}
                {tab === 'system' && <SystemTab diagnostics={ctl.query.data?.diagnostics} />}
                {(tab === 'ads' || tab === 'site' || tab === 'expert') && (
                  <SaveBar dirty={ctl.dirty} saving={ctl.saving} note={ctl.note} onSave={ctl.save} onDiscard={ctl.discard} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
