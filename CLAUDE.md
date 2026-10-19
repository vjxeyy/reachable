# REACHABLE: Claude Code guide

*Know before you go.* A live campus accessibility map. It suggests obstacle types from photos and reroutes
wheelchair, crutch and low-vision users the moment a barrier is reported or cleared.

PLAN.md is the source of truth. This file summarises it (sections 5, 6 and 9) plus the extra rules for this build.
If the two disagree, PLAN.md wins. Record any interpretation in the "Interpretations" section below.

## Stack

| Part | Choice |
|---|---|
| Frontend | Vite + React + TypeScript |
| Map | Custom SVG map drawn from `data/campus.json` |
| Routing | Dijkstra in plain TypeScript (`src/core`) |
| Backend | Node + Express (`server/`), run with `tsx` |
| Database | SQLite via `better-sqlite3` |
| Photos | Local `uploads/` folder |
| AI classifier | One interface: simulated version + real model, automatic fallback to simulated |
| Tests | Vitest (`npm test`) |

## Folder structure

```
reachable/
  CLAUDE.md  PLAN.md  README.md  .env.example
  data/campus.json          the campus (nodes + paths), pure data
  src/
    core/                   routing + trust logic: NO React, NO network, NO hard-coded node names
      types.ts graph.ts profiles.ts trust.ts route.ts route.test.ts
    classifier/             index.ts (picks one), simulated.ts, real.ts (Phase 7)
    components/             CampusMap, RoutePanel, ReportForm, ReportList, TrustBadge
    pages/                  Home.tsx, Admin.tsx
    state/store.ts          localStorage store, switches to the API when the backend is up
    App.tsx
  server/                   index.ts, db.ts, routes/  (Express + SQLite)
  uploads/                  uploaded photos (git-ignored)
```

## Commands

`npm run dev` (frontend, :5173) · `npm run server` (API, :8787) · `npm test` · `npm run build` ·
`npm start` (built app + API on :8787) · `npm run demo:check` (scripted 60-second demo against a running API) ·
`npm run lint`

## Data model (PLAN.md section 5)

- **Node**: `id, name, x, y, areaId`
- **Path**: `id, from, to, lengthM, stepFree, widthM, slopePct, areaId` (paths are two-way)
- **Report**: `id, pathId, category, severity, status, confidence, photoUrl, description, createdAt, lastConfirmedAt, clearedAt`
- **Confirmation**: `reportId, vote (still_there | cleared), at`
- Categories: `blocked_ramp, parked_vehicle, flooding, broken_pavement, missing_kerb_cut, other`
- Severity: `blocked` (fully impassable) or `partial`
- Status (derived, never trusted from storage): `verified, unverified, outdated, cleared`
- Every record carries `areaId`, so a second campus is just another data file.

## Routing rules (PLAN.md section 6)

`cost = lengthM + profilePenalty + obstaclePenalty`

Profiles. These are starting values from the plan; tune them only in `src/core/profiles.ts`.

| Profile | Hard rule (path excluded) | Soft penalty |
|---|---|---|
| Wheelchair | not stepFree, widthM < 0.9, slope > 8% | slope 5 to 8%: +30 |
| Crutches | slope > 10% | slope 6 to 10%: +25; path longer than 150 m: +10 |
| Low vision | none | width < 1.5 m: +20; any active obstacle: treated as blocking |

Obstacle effect by report status:
- `verified` + `blocked`: path **excluded**
- `unverified` + `blocked`: +200 (the route avoids it if any alternative exists)
- `partial`: +60 for wheelchair and crutches, +30 for low vision
- `outdated`: +20 (shown as a warning, no longer blocks)
- `cleared`: no effect

Trust and freshness:
- Confidence = AI confidence (0 to 1) combined with the number of confirmations.
- Two or more independent "still there" confirmations, or an admin verify, makes a report `verified`.
- A report becomes `outdated` after this long without a new confirmation: parked vehicle 3 h, flooding 12 h,
  blocked ramp 3 days, broken pavement 30 days, missing kerb cut 90 days, other 3 days.

Fail-safe: if no path remains after hard exclusions and blocks, return `{ status: "no_verified_route" }` plus the best
unverified option labelled **"Unverified, use with caution"**. Never present an uncertain path as accessible.

## Acceptance checks (PLAN.md section 8, all in `src/core/route.test.ts`)

1. Wheelchair route never uses a path with `stepFree: false`.
2. Crutches route may use a gentle stepped path that Wheelchair may not.
3. A verified blocked ramp on the shortest step-free route changes the route to a longer step-free route.
4. An unverified block adds a penalty but leaves the path usable when no alternative exists; result labelled unverified.
5. Blocking all step-free links between two places returns `no_verified_route`.
6. Marking the block cleared restores the original route.
7. A report older than its decay time becomes `outdated` and stops hard-blocking.
8. Same query with identical data returns the identical route (no randomness).

## Working rules (PLAN.md section 9 + this build)

- Work phase by phase, in order. Ask the user before starting each phase.
- At the end of every phase: `npm test`, then `npm run build`. Fix failures, then commit with a clear message.
- Keep routing and trust logic in `src/core` with no React, DOM, `fetch` or Node APIs inside it.
  Core functions take the campus, reports and `now` as arguments, so the client, the server and the tests share them.
- The campus is data in `data/campus.json`. Never hard-code node or path names or ids in logic. Tests may name ids.
- The acceptance checks must pass before any UI work starts.
- Label simulated classifier output on screen as **"AI suggestion (demo)"**. The user always confirms or corrects it.
- Do not claim a route is accessible. Show report status and age. An uncertain route is never shown as the route.
- Real classifier: behind the same interface as the simulated one, chosen from env in `server/classifier-config.ts`:
  OpenRouter free vision model when `OPENROUTER_API_KEY` is set (or `CLASSIFIER=openrouter`), CLIP when
  `CLASSIFIER=clip`, else the simulated classifier. Keys come only from env vars. If the real model is off, fails,
  is still loading or is too slow, fall back to the simulated classifier. Keep `.env.example`, never commit `.env` or a key.
- The app must work with no backend (localStorage store) and switch to the API when it is reachable.
- Demo support: 3 or 4 pre-seeded reports, a "Reset demo" button, and a "+6 hours" time control.
- Must be usable at phone width (about 360 px).
- Tests never touch the real database. Server tests use an in-memory SQLite database. `server/db.ts` refuses
  to open the real database file while running under Vitest.

## Interpretations (decisions where PLAN.md is open)

Write each decision down here when it is made, so later phases stay consistent.

1. **Two-pass fail-safe** (`src/core/route.ts`). The strict pass drops hard-rule paths and every blocking
   report, verified or unverified. A route found there is `status: "ok"`, the only kind shown as the route.
   If none is found, the fallback pass keeps verified blocks excluded and charges +200 per unverified block.
   That route is returned as `no_verified_route` with `alternative` labelled "Unverified, use with caution".
   This is the only reading where "plus the best unverified option" can exist. It also makes demo step 4 work
   (a fresh, unverified second block gives "No verified step-free route"), and it guarantees "avoids it if any
   alternative exists" even when the detour is more than 200 m longer.
2. **Low vision**: "any active obstacle treated as blocking" covers partial reports too. A verified partial
   report is excluded and an unverified one acts as an unverified block. The +30 partial value stays in
   `profiles.ts` but cannot fire while `activeObstacleBlocks` is on.
3. **Several reports on one path do not stack.** The worst one counts, so duplicates are not double-counted.
4. **Data model additions** (listed fields keep their exact names): Report gains `areaId`, `reporterId`,
   `adminVerifiedAt` and `aiCategory`; Confirmation gains `areaId` and `voterId`. Timestamps are epoch ms.
5. **Independent confirmations** = distinct `voterId`s voting `still_there`, not counting the reporter's own
   device. The original report is not a confirmation, so verified means reporter + 2 others, or an admin.
   The reporter's own "still there" neither counts nor refreshes freshness. A device can say "still there"
   again after 30 minutes; that refreshes freshness but still counts once (`voteBlockReason` in trust.ts).
6. **Freshness**: `lastConfirmedAt` = the latest of the report, a `still_there` vote and an admin verify.
   A verified report also goes outdated if nobody re-confirms it within its decay time.
7. **Clearing**: one `cleared` vote or an admin resolve clears a report immediately (Phase 4 needs instant
   restore). Cleared is final; a returning obstacle is filed as a new report.
8. **Confidence shown** = `1 - (1 - aiConfidence) * 0.5^confirmations`, and 1 after an admin verify.
   Status depends only on counts and age, as written in the plan.
9. **Why a route changed**: the core also computes the "usual" route (same profile, no reports). If the route
   differs, `reroute.because` lists the reports on the usual route. For `no_verified_route`, `blockedBy` lists
   the reports where clearing any single one would bring a route back.
10. **Campus**: `areaId` is the campus id (`ashgrove`). The Workshop has no step-free access at all, which
    gives a natural `no_path_for_profile` example. Health Centre is the area whose only step-free link is
    one ramp. Admin to Library and Lab to Lecture Halls each have a stepped shortcut and a longer step-free route.
11. **Backend** (`server/`): every endpoint lives under `/api` (`/api/reports`, `/api/reports/:id/confirm|clear|verify|resolve`,
    `/api/route`, `/api/health`, `/api/campus`). Photos are written to `uploads/` and served at `/uploads/...`.
    Requests may carry `at` (the client's demo clock) so "+6 hours" behaves the same on the server.
    Admin endpoints have no login in this prototype.
12. **Store sync**: the browser uses the API when `/api/health` answers, polls every 5 s, and falls back to
    localStorage (keeping the last server snapshot) when the server is unreachable. It re-checks every 15 s.
    Reports made offline stay in that browser; they are not uploaded later.
13. **Real classifiers** (`src/classifier/openrouter.ts`, `src/classifier/clip.ts`, `server/classifier-config.ts`),
    server only (`POST /api/classify`), always wrapped in `withFallback` so the app never breaks:
    - **OpenRouter** (works on Render): `fetch` to `/chat/completions` with the photo as a base64 data URL and a prompt
      asking for one JSON score per category; `models` lists up to three free vision models (default Gemma 4 26B and 31B,
      Nemotron VL, all `:free`), temperature 0. Scores are normalised to sum to 1. Free limits: about 20 requests/min and
      50/day without bought credits. 9 s request limit, 10 s fallback limit (browser waits 13 s). Verified only against a
      local stand-in server; never called live in this build because no key was available.
    - **CLIP** (`CLASSIFIER=clip`): `Xenova/clip-vit-base-patch32` via `@huggingface/transformers`, one text description per
      category. Needs about 400-500 MB of memory, so local machines only. Verified live on the sample photos
      (`npm run clip:check`). Loaded lazily, so a server that does not use it never loads it.
    The simulated classifier is always labelled "AI suggestion (demo)".
    History: a Claude vision classifier (needs a paid key) and hosted Hugging Face CLIP were considered and dropped;
    Hugging Face's hosted service serves no CLIP model and gives free accounts no credits.
