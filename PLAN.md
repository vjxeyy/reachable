# REACHABLE: Prototype Build Plan (for Claude Code)

Tagline: *Know before you go.*
One line: A live campus accessibility map that suggests obstacle types from photos and reroutes wheelchair, crutch and low-vision users the moment a barrier is reported or cleared.

## 1. Goal and success test

Build a working web prototype for one made-up campus. It is successful if this 60-second demo works without any manual fixing:

1. Choose the **Wheelchair** profile, route Library to Hostel. A step-free route appears.
2. Report a **blocked ramp** on that route (upload photo, AI suggests a category, user confirms).
3. The route **redraws** through a longer step-free path, with a label showing why.
4. Report a second block so no path is left. The app says **"No verified step-free route"** instead of drawing a risky path.
5. Mark one obstacle **cleared**. The route returns.

## 2. Scope

**In the prototype**
- One campus (about 15 nodes, 25 paths), stored as data
- 3 profiles: Wheelchair, Crutches, Low vision
- Photo report, AI-suggested category, user confirm or correct
- Verified / unverified / outdated labels, freshness decay
- Live rerouting, fail-safe "no verified route"
- Mark cleared
- Admin page to verify and resolve reports

**Not in the prototype (roadmap slide)**
Live GPS, indoor maps, user accounts, risk-aware routing (route chosen for fewest single points of failure), passive confirmation, pattern learning, passable-width estimation.

## 3. Stack

| Part | Choice | Reason |
|---|---|---|
| Frontend | Vite + React + TypeScript | Fast to scaffold, easy for Claude Code to extend |
| Map | Custom SVG campus map | Made-up campus, no tile server or API key needed |
| Routing | Dijkstra in plain TypeScript (`src/core`) | No dependency, easy to unit test |
| Backend (Phase 6) | Node + Express | Small API surface |
| Database (Phase 6) | SQLite (`better-sqlite3`) | One file, no setup; swap for Supabase later |
| Photos | Local `uploads/` folder | Simple for a demo |
| AI classifier | Interface with a simulated version first; real model in Phase 7 | Keeps the demo working if the model fails |
| Tests | Vitest | Verifies the routing rules |
| Deploy | Vercel (frontend), Render or Railway (backend) | Free tiers |

If you have no time for a backend, stop after Phase 5 and keep reports in `localStorage`.

## 4. Folder structure

```
reachable/
  CLAUDE.md
  PLAN.md
  data/campus.json
  src/
    core/
      types.ts
      graph.ts
      profiles.ts
      trust.ts
      route.ts
      route.test.ts
    classifier/
      index.ts
      simulated.ts
      real.ts            (Phase 7)
    components/
      CampusMap.tsx
      RoutePanel.tsx
      ReportForm.tsx
      ReportList.tsx
      TrustBadge.tsx
    pages/
      Home.tsx
      Admin.tsx
    state/store.ts
    App.tsx
  server/                (Phase 6)
    index.ts
    db.ts
    routes/
```

## 5. Data model

**Node**: `id, name, x, y, areaId`
**Path**: `id, from, to, lengthM, stepFree, widthM, slopePct, areaId`
**Report**: `id, pathId, category, severity, status, confidence, photoUrl, description, createdAt, lastConfirmedAt, clearedAt`
**Confirmation**: `reportId, vote (still_there | cleared), at`

Categories: `blocked_ramp, parked_vehicle, flooding, broken_pavement, missing_kerb_cut, other`
Severity: `blocked` (fully impassable) or `partial`
Status (derived): `verified, unverified, outdated, cleared`

Every record carries `areaId` so a second campus is just another data file.

## 6. Routing rules

Cost of a path for a profile:

`cost = lengthM + profilePenalty + obstaclePenalty`

**Profiles (starting values, tune while testing)**

| Profile | Hard rule (path excluded) | Soft penalty |
|---|---|---|
| Wheelchair | not stepFree, widthM < 0.9, slope > 8% | slope 5 to 8%: +30 |
| Crutches | slope > 10% | slope 6 to 10%: +25; path longer than 150 m: +10 |
| Low vision | none | width < 1.5 m: +20; any active obstacle: treated as blocking |

**Obstacle effect (by report status)**
- `verified` + `blocked` severity: path **excluded**
- `unverified` + `blocked`: penalty +200 (route avoids it if any alternative exists)
- `partial`: penalty +60 for wheelchair and crutches, +30 for low vision
- `outdated`: penalty +20 (shown as a warning, no longer blocks)
- `cleared`: no effect

**Trust and freshness**
- Confidence = AI confidence (0 to 1) combined with number of confirmations. Two or more independent confirmations, or an admin verify, makes a report `verified`.
- Freshness decay by category (a report becomes `outdated` after this time without a new confirmation): parked vehicle 3 hours, flooding 12 hours, blocked ramp 3 days, broken pavement 30 days, missing kerb cut 90 days, other 3 days.

**Fail-safe**
If no path remains after hard exclusions and `verified` blocks, return `{ status: "no_verified_route" }` plus the best unverified option labelled "Unverified, use with caution". Never present an uncertain path as accessible.

## 7. Phases (each ends with something you can run)

Work one phase at a time. Start each Claude Code session with: "Read CLAUDE.md and PLAN.md, then do Phase N only."

### Phase 0: Setup (30 min)
**Prompt:**
> Scaffold a Vite + React + TypeScript project called reachable with Vitest. Create CLAUDE.md summarizing the project, the folder structure and the rules from PLAN.md sections 5 and 6. Do not build features yet.

**Done when:** `npm run dev` and `npm test` both run.

### Phase 1: Campus data and routing core (2 to 3 hours)
**Prompt:**
> Create data/campus.json with 15 nodes and about 25 paths for a fictional campus (gate, library, hostel, canteen, lab block, admin block, sports ground, health centre and similar). Include at least two buildings reachable by both a stepped shortcut and a longer step-free route, and one area with a single ramp as the only step-free link. Then implement src/core (types, profiles, trust, route) following PLAN.md section 6, with Dijkstra and the no_verified_route result. Write Vitest tests for every acceptance check in section 8.

**Done when:** all core tests pass with no UI.

### Phase 2: Map and route finder (3 to 4 hours)
**Prompt:**
> Build CampusMap.tsx as an SVG map drawn from campus.json, plus RoutePanel.tsx with from, to and profile selectors. Highlight the chosen route, show distance and a "step-free" tag, and show a clear message for no_verified_route. Paths with stepFree false should look different.

**Done when:** you can pick two places and see different routes per profile.

### Phase 3: Reporting and AI suggestion (3 to 4 hours)
**Prompt:**
> Add ReportForm.tsx: click a path on the map, upload a photo, choose severity, add a description. Add the classifier interface in src/classifier with a simulated implementation that returns a category and confidence, clearly labelled "AI suggestion (demo)". Show the suggestion, let the user confirm or change it, then save the report to the store. New reports must trigger an immediate route recalculation.

**Done when:** reporting a blocked ramp visibly changes the route.

### Phase 4: Trust, freshness, clearing (2 to 3 hours)
**Prompt:**
> Add TrustBadge.tsx showing verified, unverified or outdated with report age. Implement freshness decay and confirmation counts from PLAN.md section 6. Add "Still there" and "Cleared" buttons on each report. Cleared reports must immediately restore the route. Add a toggle that fast-forwards time by 6 hours so the demo can show a report going outdated.

**Done when:** the full 60-second demo in section 1 works.

### Phase 5: Admin page (2 hours)
**Prompt:**
> Add an Admin page listing all reports with filters by status and category, buttons to verify or resolve, and a count of affected paths. Verifying a report sets it to verified immediately.

**Done when:** an admin verify turns an unverified block into a hard block and the route updates.

### Phase 6: Backend and shared data (1 day)
**Prompt:**
> Add an Express server with SQLite. Implement POST /reports, GET /reports, POST /reports/:id/confirm, POST /reports/:id/clear, GET /route, and photo upload to uploads/. Move the store to call the API, keep routing logic in src/core so server and client share it. Seed the database from campus.json.

**Done when:** a report made on one browser appears on another.

### Phase 7: Real classifier (half a day, optional)
**Prompt:**
> Implement src/classifier/real.ts behind the same interface using a zero-shot image classifier (CLIP via Hugging Face Inference API, or a vision model API). Use the six categories as labels, return confidence, and fall back to the simulated classifier if the call fails or times out after 5 seconds. Read the key from an environment variable and never commit it.

**Done when:** a real photo gets a sensible suggestion, and the app still works with the key removed.

### Phase 8: Polish, deploy, rehearse (half a day)
- Seed 3 or 4 realistic example reports so the map is not empty on first load.
- Add a "Reset demo" button.
- Make it usable on a phone width.
- Deploy and test the live link on a phone.
- Rehearse the 60-second demo three times.

## 8. Acceptance checks (write these as tests)

1. Wheelchair route never uses a path with `stepFree: false`.
2. Crutches route may use a gentle stepped path that Wheelchair may not.
3. Adding a verified blocked ramp on the shortest step-free route changes the route to a longer step-free route.
4. An unverified block adds a penalty but leaves the path usable when no alternative exists, and the result is labelled unverified.
5. Blocking all step-free links between two places returns `no_verified_route`.
6. Marking the block cleared restores the original route.
7. A report older than its decay time becomes `outdated` and stops hard-blocking.
8. Same query with identical data returns the identical route (no randomness).

## 9. Working rules for Claude Code

- One phase per session; run tests before moving on.
- Keep routing and trust logic in `src/core`, with no React or network code inside it.
- The campus is data. Never hard-code node names in logic.
- Label simulated AI output on screen as a demo suggestion.
- Do not claim a route is accessible. Show status and age.
- Commit after each phase with a clear message.

## 10. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Real classifier is inaccurate or down | Simulated classifier plus user confirmation (already built) |
| Backend takes too long | Ship Phase 5 with `localStorage`, say shared data is next |
| Demo data looks empty | Pre-seeded reports and Reset demo button |
| Judge asks about fake reports | Unverified reports only add a penalty; blocking needs 2 confirmations or admin verify |
| Judge asks "how is this different from StreetCo or Route4U?" | Verification-aware routing, fail-safe "no verified route", freshness by category, facilities dashboard |

## 11. Suggested timeline

| Block | Phases | Result |
|---|---|---|
| Day 1 | 0 to 2 | Map and routing by profile |
| Day 2 | 3 to 5 | Full demo works in the browser |
| Day 3 | 6 | Shared reports across devices |
| Day 4 | 7 to 8 | Real AI, deploy, rehearsal |

Stopping after Day 2 still gives a complete, demonstrable prototype.
