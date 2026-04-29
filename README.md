# Lake Stevens Water Conditions

Live water-ski conditions for Lake Stevens, WA. Hourly wind/gust/precip forecast from Open-Meteo, concise launch outlook and expert opinion from Claude Haiku, weekly forecast summary, daily water temperature, and a color-coded ski rating.

## How it runs

```
GitHub Actions (hourly cron)
  → scripts/fetch-forecast.mjs
      → Open-Meteo  (hourly + 7-day forecast data)
      → LakeMonster  (daily morning water temperature)
      → Claude API  (hourly concise outlook + expert opinion)
      → Azure Blob Storage  (current-forecast.json)

Azure Static Web Apps (free tier)
  → frontend/  (React, Vite)
      → fetches the blob on load
```

No database. No Azure Functions. The blob is the API.

## Forecast data

The blob keeps the original fields (`summary`, `proName`, `launchQuip`, `hours`) for compatibility and adds structured fields for the redesigned UI:

- `outlook` — hourly concise launch guidance with `headline`, `bestWindow`, and `watchOut`.
- `expertOpinion` — hourly pro-skier-style recommendation, kept short and dry.
- `dailyForecast` — compact 7-day forecast cards with high/low, rain chance, wind/gusts, best rating, and best window.
- `weeklySummary` — one short weekly read for the best upcoming launch windows.
- `waterTemp` — Lake Stevens water temp checked once each Pacific morning.

Water temperature is sourced from LakeMonster. If an official endpoint is not available, the fetch script scrapes the public Lake Stevens page once in the morning and reuses the last known value if the scrape fails or the page changes.

## Local dev

### Run the fetch script once

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=...;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net"
npm install
npm run fetch
```

Verify the blob appears in the `forecast` container as `current-forecast.json`.

### Run the frontend

```bash
cd frontend
npm install
echo "VITE_FORECAST_URL=https://<your-account>.blob.core.windows.net/forecast/current-forecast.json" > .env.local
npm run dev
```

## Deployment

### One-time Azure setup
1. **Storage Account** (Standard LRS, cheapest tier).
   - Create container `forecast` with **anonymous container** access level.
   - Configure CORS: allow `GET` from your Static Web App origin.
2. **Static Web App** (Free plan).
   - Connect to this GitHub repo. App location `frontend`. Output `dist`. API location empty.
   - Add env var `VITE_FORECAST_URL` pointing at the blob.
3. **GitHub repo secrets:**
   - `ANTHROPIC_API_KEY` — Anthropic API key.
   - `AZURE_STORAGE_CONNECTION_STRING` — full storage connection string.

### Recurring
- The hourly fetch runs automatically via `.github/workflows/fetch-forecast.yml` (cron `0 * * * *`).
- Outlook and expert opinion update on each hourly fetch.
- Water temperature is checked at most once each Pacific morning, then cached in the blob for the rest of the day.
- Use `workflow_dispatch` to trigger manually after secrets change.
- Frontend redeploys via SWA whenever you push to `main`.

## Costs

- Azure Static Web Apps Free: $0
- Azure Blob Storage (Standard LRS, < 1 MB): ~$0
- GitHub Actions: free for public repos
- Claude API: hourly outlook, weekly summary, and expert-opinion calls; still intended to stay low-cost on Haiku.

## Files of note

- `scripts/fetch-forecast.mjs` — the only piece of business logic.
- `frontend/src/styles/tokens.css` — design tokens. Restyle from here.
- `frontend/src/components/` — small components (NowCard, WeeklyForecast, DayTabs, HourRow, Legend).
