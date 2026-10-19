# REACHABLE

*Know before you go.*

A live campus accessibility map that suggests obstacle types from photos and reroutes wheelchair, crutch and
low-vision users the moment a barrier is reported or cleared. This is a working prototype for one fictional
campus (Ashgrove University). The build plan is in [PLAN.md](PLAN.md); the rules the code follows are in [CLAUDE.md](CLAUDE.md).

## What it does

- **Routes by profile, and by combinations of them.** Wheelchair, Crutches or Low vision, each with its own hard
  rules and penalties (steps, width, slope, path length). Tick more than one (for example Wheelchair and Low vision)
  and the route follows the strictest rule of each: every hard rule applies and the penalties add up.
- **Photo reports.** Tap a road on the map, or open **Report obstacle** (`#/report`) and pick the road from a list,
  which is easier on a phone. Take or upload a photo and the app suggests what the obstacle is. You confirm or correct it.
- **Verification-aware routing.** New reports are *unverified*: routes avoid them whenever another way exists.
  A report blocks a path outright only after 2 independent confirmations or an admin verify.
- **Fail-safe.** If every path is blocked, the app says **"No verified step-free route"** instead of drawing a
  risky one. The best unverified option is available on request, labelled *"Unverified, use with caution"*.
- **Freshness.** Reports go *outdated* if nobody re-confirms them (parked vehicle 3 h, flooding 12 h, blocked
  ramp 3 days, broken pavement 30 days, missing kerb cut 90 days). Outdated reports warn but no longer block.
- **Still there / Cleared.** Anyone can confirm or clear a report; clearing restores the route instantly.
- **Dashboard** (`#/admin`). Filter reports, verify or resolve them, and see how many paths are affected.
- **Works offline.** Without the server, reports live in the browser (localStorage). When the server is up,
  reports are shared between devices.

## Setup

You need **Node.js 22.12 or newer** (tested with Node 24) and npm.

```bash
npm install
```

On Windows, `better-sqlite3` installs a prebuilt binary. If that ever fails, install the
"Desktop development with C++" workload from the Visual Studio Build Tools and run `npm install` again.

Optional: copy `.env.example` to `.env` and fill in what you need (see [Environment variables](#environment-variables)).

## Running it

### Frontend only (no backend)

```bash
npm run dev
```

Open http://localhost:5173. The header shows **This browser only**: reports are saved in this browser.

### Frontend and backend (shared reports)

Run these in two terminals:

```bash
npm run server
```

```bash
npm run dev
```

The API runs on http://localhost:8787 and Vite forwards `/api` and `/uploads` to it. Within about 15 seconds the
header switches to **Shared server**. A report made in one browser then appears in every other browser within
5 seconds. If the server stops, the app keeps working in **This browser only** mode.

### One process (production build)

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:8787. The server serves both the built app and the API.

### On a phone (same Wi-Fi)

Start the server, then run Vite on your network:

```bash
npm run dev:lan
```

Open the `Network:` address Vite prints (for example `http://192.168.1.20:5173`) on the phone.
Alternatively, after `npm run build`, run `npm start` and open `http://<your-PC-IP>:8787`.
Windows may ask to allow Node through the firewall.

## Environment variables

All optional. Server variables go in `.env` (git-ignored, never commit it) or the host's settings.

| Variable | Used by | What it does |
|---|---|---|
| `OPENROUTER_API_KEY` | server | Turns on the real photo classifier: a free vision model through [OpenRouter](https://openrouter.ai) (free key, see below). Without any real classifier the demo one is used and labelled **"AI suggestion (demo)"**. |
| `OPENROUTER_MODEL` | server | Optional. Up to three comma-separated OpenRouter model ids to try in order. Default: three free Gemma/Nemotron vision models. |
| `CLASSIFIER` | server | Optional. `openrouter`, `clip` or `simulated`. Default: OpenRouter if `OPENROUTER_API_KEY` is set, otherwise the demo classifier. `clip` runs CLIP on the server instead (see below). |
| `MODEL_CACHE_DIR` | server | Where the CLIP model is stored. Default `server/data/models`. |
| `PORT` | server | API port. Default `8787`. |
| `DB_PATH` | server | SQLite file. Default `server/data/reachable.db`. |
| `UPLOADS_DIR` | server | Folder for uploaded photos. Default `uploads/`. |
| `CORS_ORIGIN` | server | Allowed browser origin if the frontend is hosted elsewhere. Default: any. |
| `VITE_API_URL` | frontend build | API origin if the frontend is hosted elsewhere (for example on Vercel). Leave empty for same origin. |

### Real photo classifier (free)

Two real options sit behind the same interface. Both always fall back to the demo classifier, so reporting never breaks.

**OpenRouter (works on Render):** a free vision model reads the photo and scores the six categories.

1. Make an account at https://openrouter.ai and create a key (Keys page). The default models are the ones whose id
   ends in `:free`, so they cost nothing; check OpenRouter's sign-up page for whether it asks for a card.
2. Locally, put it in `.env` as `OPENROUTER_API_KEY=...` (git-ignored). On Render, add it under the service's
   **Environment** settings. Never put it in the repo or paste it into a chat.
3. Restart. The start-up log says `Photo classifier: OpenRouter ...`, and the suggestion label reads
   *AI suggestion · <model name>* instead of *AI suggestion (demo)*.

- Free models are rate-limited: about 20 requests a minute and **50 a day** without bought credits (1,000 a day
  after buying 10 credits). Past that, or if a model is slow or down, the app shows the demo suggestion and says why.
- The photo is sent to OpenRouter and the model's provider. Free models may log or train on what they receive, so
  use only photos you are happy to share.
- The first reply can take several seconds. The server waits up to 10 s, then falls back.

**CLIP on your own machine:** no key and no account; the photo never leaves the server.

```bash
CLASSIFIER=clip npm run server
```

On Windows PowerShell: `$env:CLASSIFIER="clip"; npm run server`. Or put `CLASSIFIER=clip` in `.env`.

- The first start downloads the model (about 90 MB) from the public Hugging Face Hub into `server/data/models`.
  After that it loads in about a second and classifies a photo in about 50 ms.
- It needs **about 400 to 500 MB of memory**, so it does not fit Render's free plan (512 MB).
- Check it on the three sample photos with `npm run clip:check`.
- CLIP matches pictures to descriptions, so it is less precise than a large vision model. The descriptions it
  matches are in `src/classifier/clip.ts`.

Either way the user always confirms or corrects the category.

## The 60-second demo

Start from a fresh load, or press **Reset demo** under **Demo tools** at the bottom of the page. Reset restores the 4 example reports (each is
tagged **Example**, so nobody mistakes them for real reports), sets the clock back to now and clears the route picker.
The photo buttons are labelled **Sample drawing**: they are bundled illustrations, not photos.

1. **Route.** Choose From **Library**, To **Hostel**, with **Wheelchair** ticked.
   A step-free route appears (460 m, via the Canteen and the hostel ramp).
2. **Report.** Tap the **Canteen to Hostel ramp** on the map. Tap **Sample drawing: blocked ramp** (or take a
   real photo). The app shows *AI suggestion (demo): Blocked ramp*. Tap **Looks right**, then **Submit report**.
3. **Reroute.** The route redraws through Garden Court, with *"Rerouted, 105 m longer than usual, to avoid:
   Blocked ramp … Unverified, reported just now"*.
4. **Fail-safe.** Tap **Library to Garden Court** on the new route, use **Sample drawing: flooding**, confirm and submit.
   The app says **"No verified step-free route"** and lists both blocks. No route is drawn. The unverified option
   appears dashed only if you tap *Show unverified option on map*.
5. **Clear.** Tap the hostel ramp again and press **Cleared** on the report. The original route returns.

Extras if you have time:

- **+6 hours** under **Demo tools**: the example *parked vehicle* report turns **Outdated** and stops blocking.
  The clock label then reads *Demo clock: now + 6 h*, and **Back to now** undoes it.
- **Dashboard**: verify an unverified report and it becomes a hard block at once. Try Wheelchair, Main Gate to
  Health Centre with a blocked Health Centre ramp, before and after verifying.
- **Crutches**, Admin Block to Library: uses the gentle Admin steps, which Wheelchair cannot.
- **Wheelchair and Low vision** together, Library to Hostel, with a *partly blocked* report on the hostel ramp:
  Wheelchair alone still uses the ramp with a warning, but Low vision treats any report as a block, so the
  combination goes round through Garden Court.

### Rehearsal check

With the server running, this runs all 5 steps against the API and checks each one. It resets the demo data
before and after, so only use it on a demo or local server.

```bash
npm run demo:check
```

## Tests

```bash
npm test
```

116 Vitest tests, including `server/style-rules.test.ts`, which fails on purple, gradients, pill shapes, glyph icons, dashes, cursor effects and testimonial copy. The 8 acceptance checks from PLAN.md section 8 are in `src/core/route.test.ts`. The other
tests cover trust and freshness, the demo seed data, the classifiers and the API. Server tests use an
in-memory SQLite database only; `server/db.ts` refuses to open a database file while tests run. The
real classifiers are tested with stand-ins (a local fake OpenRouter server and a fake CLIP model), so the tests never need a key, a download or the internet.

## How routing works

`cost = lengthM + profilePenalty + obstaclePenalty`, found with Dijkstra in `src/core/route.ts`:

1. **Strict pass**: skip paths that break the profile's hard rules or carry any blocking report. A route found
   here is the only kind shown as "the route".
2. **Fallback pass**: verified blocks stay excluded and unverified blocks cost +200. A route found here is
   returned as `no_verified_route` with the option labelled "Unverified, use with caution".
3. Nothing left: `no_verified_route` with no option.

The same code runs in the browser, on the server (`GET /api/route`) and in the tests. The campus is data
(`data/campus.json`); no node names appear in the logic. Every judgment call where PLAN.md left room is written
down in [CLAUDE.md](CLAUDE.md) under *Interpretations*.

## API

All under `/api`. Requests may include `at` (epoch ms) so the demo clock ("+6 hours") also applies on the server.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/health` | | Server and classifier status |
| GET | `/campus` | | Campus nodes and paths |
| GET | `/reports` | | Reports (status derived) and confirmations |
| POST | `/reports` | multipart: `pathId, category, severity, confidence, aiCategory, reporterId, description, photo` | New report; photo saved to `uploads/` |
| POST | `/reports/:id/confirm` | `{ voterId }` | "Still there" |
| POST | `/reports/:id/clear` | `{ voterId }` | "Cleared" |
| POST | `/reports/:id/verify` | | Admin verify |
| POST | `/reports/:id/resolve` | | Admin resolve |
| GET | `/route?from=&to=&profile=` | | Route result from `src/core`. `profile` is one id or a comma list, e.g. `wheelchair,low_vision` |
| POST | `/classify` | multipart: `photo`, `context` | Category suggestion (OpenRouter, CLIP or simulated) |
| POST | `/demo/reset` | | Restore the example reports |

## Project structure

```
data/campus.json         the campus (15 nodes, 26 paths)
data/seed-reports.json   example reports for a fresh start / Reset demo
src/core/                routing, profiles, trust, seed builder + tests (no React, no network)
src/classifier/          interface + fallback (index), simulated, openrouter, clip
src/components/          CampusMap, RoutePanel, ReportForm, ReportList, TrustBadge
src/pages/               Home (map), Report (report obstacle), Admin (the Dashboard)
src/state/               store (localStorage or API), api client
server/                  Express app, SQLite (db.ts), routes/
scripts/demo-check.mjs   scripted 60-second demo
```

## Live demo

- **https://reachable-lemon.vercel.app**: the fast copy on Vercel. The full 60-second demo works, but
  reports stay on each device ("This browser only") and the classifier is the demo one. Only this address is
  public; the project's other `*.vercel.app` aliases are behind Vercel's login.
- **https://reachable-cg26.onrender.com**: the full app on Render, with shared reports (a report made on one
  device appears on every other). The free plan sleeps when idle, so open it about a minute before presenting.

## Deploying

**Render: full app, one free web service** (already deployed at the address above). To deploy your own copy, open
https://render.com/deploy?repo=https://github.com/vjxeyy/reachable, sign in with GitHub and click
**Deploy Blueprint**. `render.yaml` builds with `npm ci && npm run build`, starts with `npm start` and
checks `/api/health`. On the free plan:

- It sleeps after 15 minutes without traffic, and the first visit then takes about a minute. Open it a minute
  before presenting; an open tab keeps it awake.
- The disk is temporary: reports and photos reset when it restarts or redeploys, and the example reports come
  back on their own. For lasting data, use a paid plan with a disk and set `DB_PATH` and `UPLOADS_DIR` on it.
- For a real photo classifier, add `OPENROUTER_API_KEY` under the service's **Environment** settings (free key, see above). Without it the demo classifier is used. CLIP does not fit this plan's memory.

Check a deploy with `npm run demo:check -- https://<your-service>.onrender.com`. It resets the demo data there.

**Vercel: frontend only.** The project is linked to the GitHub repo, so every push to `main` redeploys it.
`vercel.json` sets the install to `npm ci --ignore-scripts` (Vercel doesn't need the native SQLite module),
the build to `npm run build` and the output to `dist`. With no API at that address, it runs in
"This browser only" mode. To connect it to a hosted API instead, build with `VITE_API_URL` set to the API and
set `CORS_ORIGIN` on the API to the Vercel address. Avoid that while the API sleeps, though: when it wakes up,
the app switches to the server's data mid-demo.

## What is simulated

- The **simulated classifier** does not look at the picture. It uses the file name, the shape of the path and a
  hash of the image, so the demo is repeatable. It is always labelled **"AI suggestion (demo)"**.
- **The Dashboard has no login**, and devices are identified by an anonymous id in the browser (no accounts).
- The campus is **fictional**; there is no GPS or indoor map.
- The map is an **illustration**, and says so on screen. Places, roads and their links come from `data/campus.json`;
  the pond and the trees are decoration, drawn the same way every time (`src/components/mapDecor.ts`) and never used by routing.

Roadmap (from PLAN.md): live GPS, indoor maps, user accounts, risk-aware routing, passive confirmation, pattern
learning, passable-width estimation.
