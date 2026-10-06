# AI Attendance — Frontend

Next.js (App Router) + TypeScript + Tailwind UI for the FastAPI attendance API
in `../backend`.

The app is a thin, typed client: every screen calls the same public API you see
in `../backend/app/api`, and all errors are surfaced through the backend's
uniform `{ "detail": ..., "code": ... }` envelope.

## Screens

| Route | What it does | API surface used |
| --- | --- | --- |
| `/` | Health dashboard — model readiness, match threshold, storage backend, database status, entity counts, auth state | `GET /health` |
| `/students` | Filter the registry by class/section, create students, expand a row to upload/list/delete face photos, delete a student | `GET/POST/PATCH/DELETE /api/students*`, `POST/DELETE /api/students/{id}/faces*` |
| `/recognition` | Dry-run a classroom photo: draws matched bounding boxes over the image, lists matches with confidence, unknown/duplicate counts and timing | `POST /api/recognition/recognize` |
| `/attendance` | Process a photo for a class + date, view the register with summary counts, correct any status by hand, inspect a row's audit trail | `POST /api/attendance/process`, `GET/PATCH /api/attendance*`, `GET /api/attendance/{id}/audit` |

## Prerequisites

- Node.js 20.19+ (developed on Node 23)
- The backend running locally — see `../backend/README.md`

**No Docker is required.** The frontend is a standard Next.js app: `npm install`
then `npm run dev`. The backend is a standard Python app: `pip install` then
`uvicorn`. Neither uses containers, and there is no `docker-compose.yml`.

## Quick start

```bash
# 1. backend (terminal A)
cd backend
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. frontend (terminal B)
cd frontend
npm install
npm run dev          # http://localhost:3000
```

The dev server proxies nothing: the browser talks to the backend directly, so
the backend's CORS allow-list must include `http://localhost:3000` (it does by
default).

### Configuration

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8000` | Backend origin used by the browser |

`NEXT_PUBLIC_*` values are inlined at build time, so restart `npm run dev` (or
rebuild) after changing one.

## API keys

The backend expects an `X-API-Key` header with two tiers:

- **teacher key** — reads, recognition, attendance processing, manual corrections
- **admin key** — student CRUD and face-photo uploads (biometric management)

Open **API keys** in the header and save one or both. They are stored only in
this browser's `localStorage` (`attendance.apiKeys`) and sent with every request.

If the backend runs with auth disabled (no keys configured — the development
default), leave both fields blank; requests go out without the header.

The dashboard's `GET /health` field `auth_enabled` tells you which mode the
server is in.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 3000 |
| `npm run build` | Production build (runs type-checking) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (Next.js + React 19 hooks rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:api` | End-to-end contract test of `lib/api.ts` against a live backend |
| `npm run test:ui` | Browser smoke test: drives all four screens in headless Edge |
| `npm test` | lint → typecheck → API contract → browser smoke |

## Testing

### `npm run test:api` — API contract (38 checks)

Drives **the same client the UI uses** (`lib/api.ts`) against a running backend,
so it proves the request/response contract the screens depend on. It covers JSON
bodies, multipart uploads with form fields, the attendance `date` / `class`
response aliases, manual corrections, the audit trail, the duplicate-photo
guard and cleanup. Uses the demo images in `backend/test_data`.

```bash
# terminal A
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app
# terminal B
cd frontend && npm run test:api
```

Expected: `38 passed, 0 failed`.

### `npm run test:ui` — browser smoke (27 checks)

Drives the real UI in headless Edge: reads the dashboard, creates a student
through the form, uploads three face photos, runs recognition, processes a
classroom photo for attendance, corrects a status, opens the audit trail,
navigates between routes, deletes the student, and finally asserts there were
**no console errors and no uncaught page errors**.

No browser download is needed — it reuses the Edge already installed on
Windows. Override the binary or the app URL if required:

```bash
EDGE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npm run test:ui
APP_URL=http://127.0.0.1:3001 npm run test:ui
```

Expected: `27 passed, 0 failed`.

## Project structure

```
app/
  layout.tsx            root shell: fonts, nav, footer
  page.tsx              dashboard (/health)
  students/page.tsx     registry, filters, create/delete, face panel host
  recognition/page.tsx  dry-run recognition + bbox overlay
  attendance/page.tsx   processing, register, corrections, audit
components/
  Nav.tsx               sticky nav + API-key drawer (useSyncExternalStore)
  ui.tsx                Card/Stat/Spinner/banners/status controls, button styles
  FacePanel.tsx         per-student face upload, listing and deletion
lib/
  api.ts                fetch wrapper: X-API-Key, ApiError, local key store
  types.ts              interfaces mirroring the Pydantic response schemas
scripts/
  api-smoke.ts          end-to-end contract test
```

### Design notes

- **Types mirror the backend exactly.** Attendance schemas serialise through
  Pydantic `serialization_alias`, so the wire keys are `date` and `class`, not
  `attendance_date` / `class_name`. `lib/types.ts` documents this.
- **Face embeddings never reach the client.** The API only returns face metadata
  (`det_score`, timestamps); the UI shows that and nothing more.
- **Confidence is labelled as similarity, not probability** everywhere it is
  displayed, matching the backend's wording.
- **`GET /api/attendance` requires `class_name` and `section`.** The attendance
  page discovers existing classes via `GET /api/students/classes` and selects the
  first one so the register loads immediately.
- **Effects only write state from callbacks** (`.then` handlers with a
  cancellation flag), per the React 19 `react-hooks/set-state-in-effect` rule.
  Explicit refreshes from buttons use the same functions with a loading flag.

## Known limitations

- **`npm run dev` needs a working WebSocket connection.** Next 16's dev client
  waits for its Turbopack HMR socket before hydrating. On a machine whose
  network stack blocks `ws://localhost` upgrades (a system/VPN proxy is the
  usual culprit — Cloudflare WARP, a corporate proxy), the dev server returns
  the HTML but the page never hydrates: no buttons respond and no API requests
  are made, with no error in the console. `curl` against the same upgrade
  returns `101 Switching Protocols`, which confirms the server is fine and the
  interception is browser-side. Everything is unaffected in a production build
  (no HMR), so the workaround is `npm run build && npm start`, or fixing the
  proxy so localhost is bypassed.
- No pagination UI: the student list requests `limit=200`. The API supports up to
  500 per page with `offset`.
- Recognition boxes are drawn for matched faces only — the API returns bounding
  boxes solely for recognised students and reports unrecognised faces as a count.
- Not a PWA and not offline-capable; every action needs the backend reachable.
- Auth is header-based with keys kept in `localStorage`. That is appropriate for
  a trusted classroom/LAN deployment, not for exposing the UI on the public
  internet without an additional session layer.

