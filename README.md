# REACHABLE

*Know before you go.*

A live campus accessibility map that suggests obstacle types from photos and reroutes wheelchair, crutch and
low-vision users the moment a barrier is reported or cleared. This is a working prototype for one fictional
campus (Ashgrove University). The build plan is in [PLAN.md](PLAN.md); the rules the code follows are in [CLAUDE.md](CLAUDE.md).

## What it does

- **Routes by profile.** Wheelchair, Crutches or Low vision, each with its own hard rules and penalties
  (steps, width, slope, path length).
- **Photo reports.** Tap a path, add a photo, and the app suggests what the obstacle is. You confirm or correct it.
- **Verification-aware routing.** New reports are *unverified*: routes avoid them whenever another way exists.
  A report blocks a path outright only after 2 independent confirmations or an admin verify.
- **Fail-safe.** If every path is blocked, the app says **"No verified step-free route"** instead of drawing a
  risky one. The best unverified option is available on request, labelled *"Unverified, use with caution"*.
- **Freshness.** Reports go *outdated* if nobody re-confirms them (parked vehicle 3 h, flooding 12 h, blocked
  ramp 3 days, broken pavement 30 days, missing kerb cut 90 days). Outdated reports warn but no longer block.
- **Still there / Cleared.** Anyone can confirm or clear a report; clearing restores the route instantly.
- **Admin dashboard** (`#/admin`). Filter reports, verify or resolve them, and see how many paths are affected.
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
| `ANTHROPIC_API_KEY` | server | Turns on the real photo classifier (Claude vision, `claude-haiku-5-5`). Without it, the simulated classifier is used and labelled **"AI suggestion (demo)"**. |
| `PORT` | server | API port. Default `8787`. |
| `DB_PATH` | server | SQLite file. Default `server/data/reachable.db`. |
| `UPLOADS_DIR` | server | Folder for uploaded photos. Default `uploads/`. |
| `CORS_ORIGIN` | server | Allowed browser origin if the frontend is hosted elsewhere. Default: any. |
| `VITE_API_URL` | frontend build | API origin if the frontend is hosted elsewhere (for example on Vercel). Leave empty for same origin. |

The real classifier has a 5-second limit. If the key is missing, the call fails, the model declines or it is too
slow, the app falls back to the simulated classifier and says why under the suggestion.

## The 60-second demo

Start from a fresh load, or press **Reset demo** in the header. Reset restores the 4 example reports, sets the
clock back to now and clears the route picker.

1. **Route.** Choose **Wheelchair**, From **Library**, To **Hostel**.
   A step-free route appears (460 m, via the Canteen and the hostel ramp).
2. **Report.** Tap the **Canteen – Hostel ramp** on the map. Tap the **Blocked ramp** sample photo (or take a
   real photo). The app shows *AI suggestion (demo): Blocked ramp*. Tap **Looks right**, then **Submit report**.
3. **Reroute.** The route redraws through Garden Court, with *"Rerouted, 105 m longer than usual, to avoid:
   Blocked ramp … Unverified, reported just now"*.
4. **Fail-safe.** Tap **Library – Garden Court** on the new route, use the **Flooding** sample, confirm and submit.
   The app says **"No verified step-free route"** and lists both blocks. No route is drawn. The unverified option
   appears dashed only if you tap *Show unverified option on map*.
5. **Clear.** Tap the hostel ramp again and press **Cleared** on the report. The original route returns.

Extras if you have time:

- **+6 hours** in the header: the example *parked vehicle* report turns **Outdated** and stops blocking.
- **Admin**: verify an unverified report and it becomes a hard block at once. Try Wheelchair, Main Gate to
  Health Centre with a blocked Health Centre ramp, before and after verifying.
- **Crutches**, Admin Block to Library: uses the gentle Admin steps, which Wheelchair cannot.

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

78 Vitest tests. The 8 acceptance checks from PLAN.md section 8 are in `src/core/route.test.ts`. The other
tests cover trust and freshness, the demo seed data, the classifiers and the API. Server tests use an
in-memory SQLite database only; `server/db.ts` refuses to open a database file while tests run. The real
classifier is tested against a local stub of the Claude API, so the tests never need a key or the network.

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
| GET | `/route?from=&to=&profile=` | | Route result from `src/core` |
| POST | `/classify` | multipart: `photo`, `context` | Category suggestion (real model or simulated) |
| POST | `/demo/reset` | | Restore the example reports |

## Project structure

```
data/campus.json         the campus (15 nodes, 26 paths)
data/seed-reports.json   example reports for a fresh start / Reset demo
src/core/                routing, profiles, trust, seed builder + tests (no React, no network)
src/classifier/          interface + fallback (index), simulated, real (Claude vision)
src/components/          CampusMap, RoutePanel, ReportForm, ReportList, TrustBadge
src/pages/               Home (map), Admin
src/state/               store (localStorage or API), api client
server/                  Express app, SQLite (db.ts), routes/
scripts/demo-check.mjs   scripted 60-second demo
```

## Deploying (not done yet)

The app has not been deployed. The simplest option is **one Render web service** that runs both parts:

- Build command: `npm install && npm run build`. Start command: `npm start`.
- Add a persistent disk (for example mounted at `/data`) and set `DB_PATH=/data/reachable.db` and
  `UPLOADS_DIR=/data/uploads`, or data resets on every deploy.
- Set `ANTHROPIC_API_KEY` in the service's environment if you want the real classifier.

To host the frontend on Vercel instead, build it with `VITE_API_URL` set to the API's address and set
`CORS_ORIGIN` on the API to the Vercel address. A frontend deployed without an API still works, in
"This browser only" mode.

## What is simulated

- The **simulated classifier** does not look at the picture. It uses the file name, the shape of the path and a
  hash of the image, so the demo is repeatable. It is always labelled **"AI suggestion (demo)"**.
- **Admin pages have no login**, and devices are identified by an anonymous id in the browser (no accounts).
- The campus is **fictional**; there is no GPS or indoor map.

Roadmap (from PLAN.md): live GPS, indoor maps, user accounts, risk-aware routing, passive confirmation, pattern
learning, passable-width estimation.
