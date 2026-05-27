# PitchIQ

A football dashboard for discovering players, following current-club results,
and viewing a simple form-based estimate for a listed upcoming fixture.

## Data Providers

Live mode combines two sources through `server/index.js`:

- [FPL unofficial API](https://fantasy.premierleague.com/api/bootstrap-static/)
  for player catalog and team assignment.
- [Football-Data.org](https://www.football-data.org/documentation/quickstart)
  for recent and upcoming team fixtures/results.
- Search returns up to 10 players and uses FPL ids internally (`fpl:<id>`).
- Match result trends and next-fixture estimate are calculated locally from
  Football-Data.org results (not provider predictions or betting guidance).
- Club-level shots/on-target/possession are shown as `-` when unavailable from
  the selected free endpoints.

## Run Live Data

Copy `.env.example` to `.env` and add your Football-Data.org API key:

```env
FOOTBALL_DATA_API_KEY=your_token_here
FOOTBALL_DATA_COMPETITION=PL
FOOTBALL_DATA_SEASON_LABEL=2025-2026
VITE_DATA_MODE=live
```

Start the local API proxy:

```bash
npm run api
```

Start React/Vite in another terminal:

```bash
npm run dev
```

Vite forwards `/api` requests to `http://127.0.0.1:3001`.

## Demo Mode

To run only with bundled records, set this in `.env` and restart Vite:

```env
VITE_DATA_MODE=demo
```

## Local API Routes

```text
GET /api/health
GET /api/players/search?q=salah
GET /api/players/:playerId/dashboard
```

The local server caches repeated free-provider calls in memory to reduce
requests while browsing players.
