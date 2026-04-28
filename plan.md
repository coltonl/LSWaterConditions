# Lake Stevens Water Conditions — Implementation Plan

## Context

You want a live water-ski conditions site for Lake Stevens, WA: hourly wind/gust/precip forecasts with a color-coded ski rating and a Claude-generated plain-English outlook. The handoff doc proposes an Azure-heavy stack (SQL DB + Functions + SWA). Working directory `C:\Users\lecolton\ClonedRepos\Personal\LSConditionsApp` is empty — this is a green-field build.

After reviewing the handoff and confirming a few facts (Open-Meteo docs, SWA API constraints), the proposed architecture has real bugs and is over-engineered for the workload (~720 fetches/month of small JSON). The recommended approach below collapses it to two moving parts: GitHub Actions for the hourly fetch, Azure Static Web Apps for hosting. No database, no Azure Functions.

---

## Issues Found in the Handoff

1. **`windgusts_10m` is wrong — and the "gotcha" warning is backwards.** Open-Meteo's actual field is **`wind_gusts_10m`** (with the underscore). I verified against the live docs. Follow the handoff verbatim and every `gustMph` is `undefined`, every rating skews "Excellent" silently.
2. **Azure SQL is not free.** Basic tier is ~$5/month. The newer "Azure SQL Database free offer" has 100k vCore-seconds/month and auto-pause limits — not "free at this scale".
3. **SWA Managed API can't host timer triggers.** Microsoft docs are explicit: SWA bundled APIs are HTTP-only. The handoff's `/api/fetchForecast` (timer) + `/api/getForecast` (HTTP) cannot coexist there.
4. **`OutlookSummary` duplicated on every forecast row.** Same string on 72 rows per fetch.
5. **"Delete future rows then insert" race window.** Mid-failure or concurrent run → empty read for a moment.
6. **No error/empty-state spec.** What renders before first fetch, or when upstream is down?
7. **Time zone ambiguity.** Open-Meteo returns naive Pacific-local strings; `DATETIME2` doesn't store TZ. Mixing UTC `FetchedAt` with Pacific `ForecastHour` is bug bait.
8. **The "existing" `lake-stevens-ski.jsx` is being abandoned.** You confirmed we're building the frontend from scratch with maintainable styles instead of adapting that file.

The recommended architecture below removes #2, #3, #4, #5 entirely and forces explicit handling of #6, #7. Issue #1 is just a code fix.

---

## Recommended Architecture

```
GitHub Actions (cron: 0 * * * *)
   1. fetch Open-Meteo (lat 47.998, lon -122.139, hourly forecast)
   2. compute SkiRating per hour
   3. call Claude API (haiku-4-5) for outlook summary
   4. PUT current-forecast.json → Azure Blob Storage (public read)

Azure Static Web Apps (Free tier)
   React app fetches the blob URL on load and renders.
```

**Why this is better than the handoff:**
- One Azure resource (SWA) instead of three. No SQL connection strings, no Function App, no `local.settings.json`.
- GitHub Actions is free for public repos and gives free observability (run history, logs, manual re-run button).
- A single JSON blob is the entire data layer. Atomic overwrite eliminates the race.
- ~$0/month all-in. Only real cost is Claude API (~720 Haiku calls/month, pennies).

**Trade-offs to know:**
- Blob storage needs CORS configured to allow the SWA origin. One-time setup.
- GitHub Actions cron is best-effort — runs can drift by several minutes under load. Fine for a weather page; not fine if you need exact-on-the-hour.
- Public-read blob means the JSON is world-readable. That's appropriate for public weather data.

---

## File Structure

```
LSConditionsApp/
├── .github/
│   └── workflows/
│       └── fetch-forecast.yml      # hourly cron + manual dispatch
├── scripts/
│   └── fetch-forecast.mjs          # the fetch + rate + summarize + upload script
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # top-level component: fetches blob, manages state
│   │   ├── components/
│   │   │   ├── NowCard.jsx         # "Right Now" hero card (current rating + summary)
│   │   │   ├── DayTabs.jsx         # Today / Tomorrow / Day-after tabs
│   │   │   ├── HourRow.jsx         # one row in the hourly list
│   │   │   └── Legend.jsx          # color-key footer
│   │   ├── lib/
│   │   │   ├── time.js             # parseLocalISO, formatHour, dayLabel helpers
│   │   │   └── rating.js           # rating → color/icon lookup (data only)
│   │   ├── styles/
│   │   │   ├── tokens.css          # CSS variables: colors, spacing, fonts (single edit point)
│   │   │   └── App.css             # component styles, referencing tokens
│   │   ├── main.jsx
│   │   └── index.css               # CSS reset + token import
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── staticwebapp.config.json    # routing + cache headers
├── package.json                    # root, for the script's deps
├── .gitignore
└── README.md                       # setup steps for future-you
```

---

## Implementation Steps

### 1. Repo + frontend scaffold
- `git init` in the working dir, add a `.gitignore` (node_modules, dist, .env).
- Scaffold the frontend: `npm create vite@latest frontend -- --template react`.
- Replace Vite's starter `App.jsx` / `App.css` with the from-scratch component breakdown described in step 4.

### 2. The fetch script — `scripts/fetch-forecast.mjs`

Single Node 20+ script, ESM, no framework. Since we own both ends, the script computes `skiRating` server-side (single source of truth — frontend just renders).

Output JSON:

```json
{
  "fetchedAt": "2026-04-28T15:00:00Z",
  "summary": "Morning looks glassy through 10am, then a light westerly fills in...",
  "hours": [
    {
      "isoTime":   "2026-04-28T15:00",
      "windMph":   4.1,
      "gustMph":   6.3,
      "precipMm":  0.0,
      "condition": "Partly cloudy",
      "skiRating": "Excellent"
    }
  ]
}
```

Pseudocode:

```js
// 1. fetch Open-Meteo
const url = new URL('https://api.open-meteo.com/v1/forecast');
url.searchParams.set('latitude', '47.998');
url.searchParams.set('longitude', '-122.139');
url.searchParams.set('hourly', 'wind_speed_10m,wind_gusts_10m,precipitation,weather_code');
//                                              ^^^^^^^^^^^^^ verified correct
url.searchParams.set('wind_speed_unit', 'mph');
url.searchParams.set('forecast_days', '3');
url.searchParams.set('timezone', 'America/Los_Angeles');

// 2. zip parallel arrays. For each hour:
//    - map weather_code -> human-readable condition string
//        (0:"Clear", 1-2:"Mostly clear"/"Partly cloudy", 3:"Overcast",
//         45-48:"Fog", 51-55:"Drizzle", 61-65:"Rain", 71-75:"Snow",
//         80-82:"Rain showers", 95-99:"Thunderstorm")
//    - compute skiRating using the handoff's code-based logic (it's correct):
//        weather_code >= 95              -> "Dangerous"
//        precip > 0.1 || code in 51..94  -> "Poor"
//        wind > 15 || gust > 20          -> "Poor"
//        wind > 10 || gust > 15          -> "Fair"
//        wind > 6  || gust > 10          -> "Good"
//        else                            -> "Excellent"

// 3. Trim to the next ~36 hours starting at the current Pacific hour.

// 4. Build a compact next-12-hours snippet, call Claude:
//      model: "claude-haiku-4-5-20251001"
//      headers: x-api-key, anthropic-version: 2023-06-01
//      max_tokens: 300
//    Prompt: local-expert, 2-3 sentences, mention best windows + warnings.

// 5. Assemble payload. fetchedAt = new Date().toISOString().

// 6. Upload via @azure/storage-blob:
//      container: 'forecast' (anonymous container access)
//      blob:      'current-forecast.json'
//      headers:   Content-Type=application/json,
//                 Cache-Control='public, max-age=300'
```

**Fix issue #7 (timezones):** `fetchedAt` is UTC ISO with `Z`. Per-hour `isoTime` stays in the naive Pacific-local format Open-Meteo returns. Frontend formats from these explicitly — never `new Date(localString)` without going through the helper.

**Fix issue #6 (errors):** if Open-Meteo fails, fail the workflow loudly (don't overwrite the blob — last-known-good stays). If Claude fails, upload the blob anyway with `summary: ""` and let the frontend hide the outlook section.

### 3. GitHub Actions workflow — `.github/workflows/fetch-forecast.yml`
- `on.schedule.cron: '0 * * * *'` (top of every hour, UTC)
- `on.workflow_dispatch:` so you can manually trigger after deploy
- Single job: checkout → setup-node 20 → `npm ci` (root) → `node scripts/fetch-forecast.mjs`
- Secrets: `ANTHROPIC_API_KEY`, `AZURE_STORAGE_CONNECTION_STRING`

### 4. Frontend — built from scratch

Built fresh, with separate components and a CSS-tokens layer so styling is easy to revise later.

**`src/styles/tokens.css`** — single edit point for the look:

```css
:root {
  /* surface */
  --bg-grad-from:    #0a1628;
  --bg-grad-mid:     #0d2b3e;
  --bg-grad-to:      #0a3040;
  --surface-card:    rgba(13, 43, 62, 0.85);
  --surface-row:     rgba(255, 255, 255, 0.03);

  /* text */
  --text-primary:    #e8f4f8;
  --text-muted:      #7ab8cc;
  --text-dim:        #5ba8c4;

  /* rating colors — keep names matching the SkiRating enum */
  --rating-excellent:#33ddaa;
  --rating-good:     #88cc44;
  --rating-fair:     #ffbb33;
  --rating-poor:     #ff6644;
  --rating-dangerous:#ff2244;

  /* spacing + radius */
  --space-1: 6px;  --space-2: 12px;  --space-3: 20px;  --space-4: 32px;
  --radius-card: 16px;  --radius-row: 10px;

  /* typography */
  --font-display: Georgia, Palatino, serif;
  --font-ui:      system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

Components consume tokens via plain CSS classes — no inline styles, so a future redesign is one file edit. (Pick CSS Modules later if you want scoped class names; plain CSS is fine to start.)

**`src/lib/rating.js`** — pure data lookup, no component coupling:

```js
export const RATING_META = {
  Excellent: { color: "var(--rating-excellent)", icon: "🏄" },
  Good:      { color: "var(--rating-good)",      icon: "🌊" },
  Fair:      { color: "var(--rating-fair)",      icon: "〰️" },
  Poor:      { color: "var(--rating-poor)",      icon: "💨" },
  Dangerous: { color: "var(--rating-dangerous)", icon: "⚡" },
};
```

**`src/lib/time.js`** — `parseLocalISO`, `formatHour`, `dayLabel`. Standard date helpers, kept out of components.

**`src/App.jsx`** — owns state, fetch, and layout:

```jsx
export default function App() {
  const [data,    setData]    = useState(null);   // { fetchedAt, summary, hours }
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [dayFilter, setDayFilter] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(import.meta.env.VITE_FORECAST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Forecast unavailable (${res.status})`);
      setData(await res.json());
    } catch (e) { setError(e.message); }
    finally     { setLoading(false); }
  }

  // Decorate hours with rating meta + dayLabel + isPast — derive, don't store.
  // Render: <Header/>, then {loading | error | <NowCard/> + <DayTabs/> + hours.map(<HourRow/>) + <Legend/>}.
}
```

**Component responsibilities (each in its own file):**
- `NowCard.jsx` — props: `hour`, `summary`, `fetchedAtPT`. Renders the hero card.
- `DayTabs.jsx` — props: `days[]`, `active`, `onChange`. Renders the segmented control.
- `HourRow.jsx` — props: `hour`, `isCurrent`, `isPast`, `expanded`, `onToggle`. Renders one row.
- `Legend.jsx` — static color key.

**Behavior:**
- Three states: `loading` (simple spinner, no "10-15s" copy), `error` (message + Retry button), `success` (the layout above).
- If `data.summary === ""` (Claude failed), the NowCard hides the Outlook section.
- `fetchedAt` is formatted from `data.fetchedAt` (UTC) via `toLocaleTimeString` with `timeZone: "America/Los_Angeles"`.
- "Today" / "Tomorrow" / weekday tabs computed from the data, not hardcoded.
- The "current hour" highlight only applies when the active tab is today (no false highlight on Tomorrow).

### 5. Azure setup (one-time, manual)
- **Storage Account** (Standard LRS, cheapest): create container `forecast` with public-read access (anonymous container access). Configure CORS to allow GET from the SWA origin.
- **Static Web App** (Free plan): connect to the GitHub repo, app location `frontend`, output `dist`. Add `VITE_FORECAST_URL` to SWA env.
- Add the storage connection string and Anthropic key as GitHub repo secrets.

### 6. `staticwebapp.config.json`
- SPA fallback (`navigationFallback` to `/index.html`).
- Cache headers for static assets.
- No auth rules — public site.

---

## Critical Files

- `scripts/fetch-forecast.mjs` — the only piece of business logic. Use the handoff's `getSkiRating` and WMO code mapping verbatim (those are correct).
- `frontend/src/App.jsx` + `components/*` — UI. Built from scratch, slim per-file.
- `frontend/src/styles/tokens.css` — single edit point for the visual system. Future restyles should mostly happen here.
- `.github/workflows/fetch-forecast.yml` — the hourly cron.
- `frontend/staticwebapp.config.json` — SPA routing.

---

## Verification

1. **Local script smoke test:** `ANTHROPIC_API_KEY=... AZURE_STORAGE_CONNECTION_STRING=... node scripts/fetch-forecast.mjs`. Confirm the blob appears, JSON parses, and **`gustMph` is a number, not undefined** on every row (regression test for the `wind_gusts_10m` bug). Spot-check one row's `skiRating` against its wind/gust/precip values.
2. **Frontend local dev:** `npm run dev` in `frontend/`, point `VITE_FORECAST_URL` at the live blob. Verify (a) loading → success render, (b) Today tab highlights the current hour, switching to Tomorrow does NOT highlight any hour as current, (c) `fetchedAt` shows blob freshness (not page load time), (d) breaking the URL shows the error state with a working Retry.
3. **Theming check:** edit one variable in `tokens.css` (e.g. flip `--rating-excellent` to magenta) and confirm it propagates everywhere — proves the no-inline-styles refactor target was met.
4. **Action manual run:** trigger via `workflow_dispatch`, watch logs, confirm blob `Last-Modified` header updates.
5. **End-to-end:** deploy SWA, hit the public URL, confirm hours, ratings, colors, and summary all render.
6. **24-hour soak:** next day, confirm cron fired ~24 times and the blob is fresh. A few minutes of drift is fine.

---

## Out of Scope (intentionally)

- Historical data / charts. Single current-forecast blob only — if you want history later, switch to Table Storage and append rows.
- User accounts, alerts, push notifications.
- A second function for an HTTP read API. The blob is the API.
- Tests. The script is small enough to verify by running it; the frontend is small enough to verify by clicking.