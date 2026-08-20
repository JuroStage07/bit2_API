# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Internal REST API for the **Horas Extra** (overtime) module of AppoloDesk. It runs
on a machine inside the corporate network — the only host with access to the
**SQL Server Bit2** database — joins SQL data with Firestore, and serves the
AppoloDesk frontend (hosted on Firebase Hosting).

```
Browser (HTTPS, Firebase Hosting)
   → ngrok tunnel (https://pleading-evaporate-crawfish.ngrok-free.dev)
   → bit2-api (HTTP, 127.0.0.1:8090, this machine)
   → SQL Server Bit2 (internal network)  +  Firestore (firebase-admin)
```

Because it lives behind an ngrok tunnel on an internal box, there is no cloud
deploy step — changes ship by restarting the Windows services
(`tools/restart-services.ps1`; see README.md).

**ngrok free serves an interstitial HTML page** (status 200) to browser-UA
requests. Every browser call must send `ngrok-skip-browser-warning: 1` or the
frontend gets HTML where it expects JSON. The `cors()` setup already allows the
header — nothing to change server-side. Note the README still documents Cloudflare
Tunnel as an *alternative*: `bit2-api.ologistics.com` does not resolve today.

## Commands

```bash
npm install        # install deps
npm start          # run the API (node src/index.js)
npm run dev        # run with --watch (auto-restart on file change)
```

There is **no test suite, linter, or build step**. To verify changes, hit
`http://127.0.0.1:8090/health` (returns `{ ok: true, service: "bit2-api" }`) and
exercise endpoints with a valid Firebase ID token. SQL access only works on a
machine with network access to Bit2, so most logic cannot be exercised locally
without that connectivity.

## Configuration

`.env` and `service-account.json` are **committed to this private repo** by a
deliberate team decision, so a fresh clone runs with no setup.

- `.env` — holds `PORT`, `CORS_ORIGINS` (comma-separated allowlist, no trailing
  slash), and `SQL_*` credentials. Being versioned makes it **shared state**: do
  not commit machine-local tweaks, they overwrite everyone else's config and can
  break the production host.
- `service-account.json` — Firebase service account key (project `oloos-bd`) at the
  repo root, or point `GOOGLE_APPLICATION_CREDENTIALS` elsewhere.
  `src/firebaseAdmin.js` throws on startup if it is missing (fail-fast).

Still gitignored and fetched out-of-band: `tools/ngrok.yml` (holds the ngrok
authtoken), `tools/ngrok.exe`, `tools/nssm.exe`, `tools/cloudflared.exe`.

## Architecture

Layered Express app. Request flow: `index.js` → route module → service → data
(`sql.js` / `firebaseAdmin.js`).

- **`src/index.js`** — app entry. Loads dotenv, eagerly requires `firebaseAdmin`
  (so a missing key fails immediately), configures the CORS allowlist, mounts
  route modules at `/`, exposes the unauthenticated `/health`.
- **`src/auth.js`** — `requireAuth` verifies the `Authorization: Bearer <Firebase
  ID token>` header, then loads the user's **role from Firestore `profiles/{uid}`**
  (not from the token) and attaches `req.user = { uid, email, role }`.
  `requireRole(...roles)` gates routes by role (case-insensitive). `safe(v)` is the
  shared string-trim helper used everywhere.
- **`src/sql.js`** — single reused `mssql` connection pool (`getSqlPool()`).
  Exports both `sql` (for typed inputs) and the pool getter.
- **`src/firebaseAdmin.js`** — initializes firebase-admin once; exports `db`,
  `FieldValue`, and the `firebaseAdmin` app.
- **Route modules** (`routes.overtime.js`, `routes.attendance.js`) — thin Express
  routers. They call `router.use(requireAuth)` then guard each route with
  `requireRole(...)`. Overtime business logic lives in the service layer; the
  attendance and `users-sync` routes hold their SQL inline.
- **`src/overtimeService.js`** — all overtime domain logic, ported from the
  previous Cloud Functions implementation.

### Roles and data access

- Two role systems exist — don't conflate them:
  - **User role** (from `profiles/{uid}.role`): `dev` sees everything;
    `administrativo` is scoped to their coordinators. Used by `requireRole`.
  - **Coordinator role** (stored in the coordinator config): `Coordinador` /
    `Gerente` (`VALID_ROLES` in overtimeService.js), plus an `excluded` flag.
    This is metadata about a coordinator, unrelated to API authorization.
- **Coordinator scoping:** Firestore doc `appConfig/overtimeCoordinatorEmails`
  maps coordinator `name` → `email`. A non-`dev` caller only sees overtime rows
  whose `nameGroup` matches a coordinator name registered to the caller's email.
  `dev` is unrestricted (`isUnrestricted`).

### Overtime calculation (overtimeService.js)

The core of `getOvertimeRecords` reads SQL rows from `dbo.view_calculatedAttendance`
joined with `dbo.view_schedules`, then splits them by day type:

- **Weekday rows:** 1 SQL row = 1 record. Overtime = minutes worked past the
  scheduled out-time (`calculateCompanyOvertime`), with a **30-minute threshold**
  below which it counts as zero.
- **Weekend rows:** grouped per `employee|date` (earliest start, latest end);
  **all** weekend time counts as overtime (`calculateWeekendOvertime`).

Times are handled in **UTC** (`getUTCHours`, `getUTCDay`, `.toISOString()`) —
preserve that convention; mixing in local-time methods will shift results.
Decisions (approve/reject) are written to Firestore collection
`overtimeApprovals/{attendanceId}` and merged back into each record on read.

## Endpoints

All except `/health` require a Firebase ID token.

| Method | Path | Role |
| --- | --- | --- |
| GET | `/health` | public |
| GET | `/overtime` | administrativo, dev |
| POST | `/overtime/decide` | administrativo, dev |
| GET | `/overtime/coordinators` | dev |
| POST | `/overtime/coordinators` | dev |
| GET | `/overtime/users-sync` | administrativo, dev |
| GET | `/attendance/marks?date=YYYY-MM-DD` | administrativo, dev |

`/attendance/marks` defaults to today and, if the requested date has no marks,
falls back to the most recent day with data (`fallback: true` in the response).

## Conventions

- User-facing error messages and code comments are in **Spanish**; keep new ones
  consistent with that.
- Service functions throw `Error` objects with a `.status` property; routes map
  that to the HTTP status (`err.status || 500`). Follow this for new service logic.
- All responses use an `{ ok: true/false, ... }` envelope.
- `docs/` contains Spanish design/spec notes (e.g. `attendance-marks-guia.md`) —
  useful background, not runtime code.
