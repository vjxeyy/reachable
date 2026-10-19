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
- Real classifier: behind the same interface as the simulated one. Read the API key from an environment variable.
  If the key is missing, the call fails or it takes more than 5 s, fall back to the simulated classifier.
  Keep `.env.example`, never commit `.env` or a key.
- The app must work with no backend (localStorage store) and switch to the API when it is reachable.
- Demo support: 3 or 4 pre-seeded reports, a "Reset demo" button, and a "+6 hours" time control.
- Must be usable at phone width (about 360 px).
- Tests never touch the real database. Server tests use an in-memory SQLite database. `server/db.ts` refuses
  to open the real database file while running under Vitest.

## Interpretations (decisions where PLAN.md is open)

Write each decision down here when it is made, so later phases stay consistent.
