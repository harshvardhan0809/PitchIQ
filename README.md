# ⚽ PitchIQ

### Matchday and player intelligence for Europe's top five leagues

PitchIQ opens on what is actually happening: the current round of fixtures, live
where applicable, alongside the players leading the competition and the numbers
behind them. From there you can search any squad member and drill into their
club's form, upcoming schedule and a transparent form-based outlook.

Built with React, Vite and a dependency-free Node HTTP proxy.

---

## 🌐 Live Demo

**Frontend:** https://pitchiq-1.onrender.com

**Backend API:** https://pitchiq-bqrr.onrender.com/api/health

---

## ✨ What it shows

### Matchday front page

The landing view picks the round that matters right now and shows it in full,
grouped by day in your own timezone:

* **Live now** — when matches are in progress
* **Playing today** — when the round is today
* **Matchday N** — the next round, with how far away it is
* Most recently completed round, when nothing is scheduled

Between seasons, when the new campaign has fixtures but no results, the app says
so rather than rendering an empty panel.

### Players to watch

The competition's leading scorers, with goals, assists and appearances from
Football-Data.org. Premier League cards are enriched from the Fantasy Premier
League API with expected goals, minutes, a portrait, and — importantly —
availability, so injuries and suspensions are visible at a glance. Selecting a
card opens that player's report.

### Player report

* Season totals (goals, assists, minutes, xG)
* The club's recent results and form
* Upcoming fixtures, merged from both providers and de-duplicated
* A form-based outlook for the next fixture

Per-match player metrics (minutes, goals, assists, xG) are Premier League only,
because that is the only competition with a free per-player feed. Elsewhere the
match rows are labelled as club results rather than dressed up as individual
returns.

### Leagues

Premier League · La Liga · Serie A · Bundesliga · Ligue 1

---

## 🚀 Running locally

```bash
npm install
cp .env.example .env     # add your Football-Data.org token
npm run api              # API proxy on :3001
npm run dev              # frontend on :5173
```

Without `VITE_DATA_MODE=live` the frontend serves a bundled sample dataset, so
the UI runs with no token and no network.

### Environment

| Variable | Purpose |
| --- | --- |
| `FOOTBALL_DATA_API_KEY` | Football-Data.org v4 token. Required for live data. |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API. Unset means any origin. |
| `CACHE_MAX_ENTRIES` | Cap on cached upstream responses (default 400). |
| `FOOTBALL_DATA_COMPETITION` | Default league when the request omits one. |
| `VITE_DATA_MODE` | `live` to use the proxy, anything else for sample data. |
| `VITE_API_URL` | API host for the frontend. Defaults to same origin. |

---

## 🔐 Accounts & plans (Supabase)

Login, accounts and sessions are handled by **Supabase Auth**. The proxy stays
the authority on entitlement: it validates the Supabase token and reads the
user's plan from `app_metadata` (which only the service role can write), so a
free user can't self-upgrade. Premium features gate on the verified plan.

**Setup (about five minutes):**

1. Create a project at [supabase.com](https://supabase.com).
2. **Project Settings → API** → copy the values into `.env`:
   - Server: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
3. **Authentication → Providers** → enable **Email** (and **Google** for OAuth).
4. **Authentication → URL Configuration** → add your site URL to the redirect
   allow-list (e.g. `http://localhost:5173`) for magic links and OAuth.

No database table is required — the plan lives in `app_metadata`. Redeeming an
access code (`PITCHIQ-PRO` by default) writes `plan: "pro"` there via the admin
API; the client refreshes its session and premium unlocks. When Supabase isn't
configured, accounts are disabled and everything is served as free (the bundled
demo simulates sign-in locally).

Swapping the access code for **Stripe** later changes only *who decides the
plan* — the same `app_metadata` write and token flow stay in place.

---

## 🏗 Architecture

```text
React (Vite)  ──►  Node proxy  ──►  Football-Data.org  (fixtures, results, squads, scorers)
                        └────────►  Fantasy Premier League  (PL player metrics, availability)
```

```text
server/
  index.js                routing, config, error mapping
  lib/
    cache.js              TTL cache, entry cap, single-flight coalescing
    http.js               HttpError with status, CORS
    competitions.js       league registry, season labels
    format.js             name normalisation and matching
    players.js            search and player dashboards
    spotlight.js          matchday selection and players to watch
    providers/            Football-Data and FPL clients
src/
  components/             UI, one concern per file
  hooks/useAsync.js       keyed async state
  lib/format.js           all date formatting, in the viewer's timezone
  services/footballApi.js API client and demo-mode switch
  data/demoData.js        offline dataset matching the live shapes
```

### Notes on the proxy

* **Credentials stay server-side.** The API token is never shipped to the browser.
* **Upstream status codes are preserved.** A provider rate limit surfaces as a
  `429` with `Retry-After`, not a generic `500`, so the client can say something
  useful instead of "request failed".
* **Requests are coalesced.** Concurrent calls for the same upstream URL share
  one request, which matters on a free tier measured in requests per minute.
* **The cache is bounded.** Entries expire and are capped, so a long-running
  instance does not grow without limit.
* **Dates cross the wire as ISO strings** and are formatted in the browser, so
  kickoff times are shown in the reader's timezone rather than the server's.

---

## 🛠 Tech Stack

**Frontend** React 19 · Vite · modern CSS
**Backend** Node.js, native `http`, no framework
**Infrastructure** Render static site + web service
**Data** Football-Data.org · Fantasy Premier League (unofficial)

Football-Data.org's free tier is rate limited; rapid league switching can
briefly return `429`, which the UI surfaces with a retry.

---

## 🔮 Roadmap

* Player comparison
* League tables alongside the matchday view
* Historical trends
* Watchlists

---

## 👨‍💻 Author

**Harshvardhan Dhankhar** — https://github.com/harshvardhan0809

## ⭐ Support

If you found this project interesting, consider giving it a star and sharing feedback.
