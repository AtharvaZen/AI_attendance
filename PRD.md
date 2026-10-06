# Product Requirements Document — AI Attendance System

| | |
|---|---|
| **Product** | AI Attendance System |
| **Version** | 0.1.0 |
| **Status** | Functional — backend, frontend, AI pipeline and MongoDB persistence complete |
| **Owner** | Software Team Project |
| **Last updated** | 2026-10-02 |

---

## 1. What It Is

An **AI-powered student attendance system** for schools. A teacher uploads one
classroom photograph; the system detects every face in it, matches each one
against a registered student database using pretrained face-recognition
embeddings, and automatically records who is present.

No AI is trained or hosted by this project. The system performs **inference
only**, using the ready-made pretrained **InsightFace `buffalo_l`** model
(SCRFD detector + ArcFace recognition network). A face is represented as a
512-dimensional numeric vector ("embedding"), and a student is identified when
the cosine similarity between their stored vectors and a detected vector is at
or above a configurable threshold.

The product is a two-tier web application: a **FastAPI** backend and a
**Next.js** frontend, persisted in **MongoDB**.

---

## 2. Problem It Solves

| Traditional paper register | This system |
|---|---|
| Manual, time-consuming marking | One photo marks the whole class |
| Subjective and error-prone | Consistent, measurable similarity scores |
| Attendance disputes have no evidence | Bounding boxes + scores provide evidence |
| Late/absent status hard to track | Status recorded per student per date |
| Silent data changes | Every manual correction is audited |
| Works only for one school | Scoped per school, isolated at the database level |

---

## 3. Who It Is For

| Role | Uses | Access |
|---|---|---|
| **School administrator** | Registers students, uploads/deletes face photos, deletes students | Admin API key |
| **Teacher** | Runs recognition, processes attendance, views history, corrects statuses | Teacher API key |
| **System operator** | Deploys, configures thresholds, manages the database | Environment / Atlas |

---

## 4. What It Does — Core Features

### 4.1 Student Management
- Register a student with roll number, name, class and section.
- Roll numbers are unique **within a class + section**, and **within a school** —
  they are deliberately not globally unique.
- List, filter (class/section), view, update and delete students.
- Deleting a student also deletes their embeddings and attendance rows.

### 4.2 Face Registration
- Upload a single photo per request; 3–10 photos per student is recommended.
- Enforced registration rules:
  - exactly **one** face in the photo (0 → error, 2+ → error),
  - face must be at least `FACE_MIN_FACE_SIZE` (60px) on its smaller side,
  - a photo too similar to one already stored is rejected (`duplicate_face`),
  - hard maximum of `FACES_PER_STUDENT_MAX` (10) embeddings per student.
- **Embeddings are stored. Raw images are never written to disk** — they are
  processed in memory and discarded.

### 4.3 Recognition
- Upload a classroom photo; every usable face is detected and embedded.
- Each embedding is matched against that school's stored embeddings.
- Faces below the threshold are reported as **unknown** — the system never
  guesses the nearest student.
- A face is accepted only when it clears **both** gates: the similarity
  threshold *and* the identification margin over the best other student
  (see §11).
- Every detection's best score, runner-up, margin and decision are returned
  as `match_details` for auditing/debugging.
- **Recognition never writes attendance** (a deliberate safety separation).

### 4.4 Attendance Processing
- Combines detection → matching → duplicate removal → attendance rows.
- **Idempotent:** re-processing the same photo for the same class and date
  never creates duplicate rows, enforced by a database unique index.
- Students recognised who are not part of the submitted class are skipped.
- Repeated appearances of the same student in one photo are collapsed to their
  best-scoring occurrence.

### 4.5 History, Correction & Audit
- View the attendance register for a class, optionally for one date, with
  present/absent/late/excused summary counts.
- Manually correct any status; every change records the previous status, new
  status and the acting role in an append-only audit trail.

### 4.6 Multi-School Isolation
Every student, embedding and attendance row is stored with a `schoolId`, and the
filter is applied **inside** every query — including inside the vector search.
One school can never match another school's students. Enforced by the database,
---

## 5. How It Works — Technical Architecture

```
┌──────────────────────────────────────┐
│  Frontend (Next.js 16, React 19)     │
│  Dashboard · Students ·              │
│  Recognition · Attendance            │
└──────────────────┬───────────────────┘
                   │ HTTPS / JSON / multipart
┌──────────────────▼───────────────────┐
│  FastAPI Backend                     │
│  Routers → Services → Repository     │
│  (auth, upload validation,           │
│   matching, attendance)              │
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│  Face pipeline (InsightFace)         │
│  SCRFD detect → ArcFace embed        │
│  → L2 normalise (512-d)              │
└──────────────────┬───────────────────┘
                   │  cosine similarity
┌──────────────────▼───────────────────┐
│  MongoDB                             │
│  schools · students ·                │
│  face_embeddings · attendance ·      │
│  attendance_audit · counters         │
└──────────────────────────────────────┘
```

### Request flow — attendance
```
Classroom photo
  → validate upload (type, size while streaming, decodable)
  → SCRFD face detection                       (face_service)
  → ArcFace 512-d embedding                    (face_service)
  → L2 normalisation                           (l2_normalize)
  → similarity search, filtered by schoolId    (repository)
  → threshold compare → Unknown if below       (matching_service)
  → per-student best match only                (matching_service)
  → idempotent attendance upsert               (attendance_service)
```

### Layered design
Routers and services depend **only** on the abstract `AttendanceRepository`
interface plus plain dataclasses — never on a database driver. Two backends are
interchangeable and verified to expose identical signatures:

| Backend | When used | Status |
|---|---|---|
| `MongoAttendanceRepository` | `MONGODB_URI` set | Persistent — production |
| `InMemoryAttendanceRepository` | `MONGODB_URI` empty | Demo / development |
---

## 6. Tech Stack

### Backend
| Technology | Version | Purpose |
|---|---|---|
| Python | 3.11+ (verified 3.13.15, Windows x64) | Runtime |
| FastAPI | 0.142.2 | REST API, OpenAPI docs, dependency injection |
| Uvicorn | 0.54.0 | ASGI server |
| Pydantic | 2.13.5 | Request/response validation |
| pydantic-settings | 2.15.0 | Environment configuration |
| python-multipart | 0.0.32 | Image upload parsing |
| InsightFace | 2.0 | Face detection + recognition (inference only) |
| ONNX Runtime | 1.30.0 | Model execution (CPU; GPU swappable) |
| OpenCV | 5.0.0.93 | Image decoding, encoding, annotation |
| NumPy | 2.5.3 | Vector maths |
| PyMongo | 4.10.1 | MongoDB driver |

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| Next.js | 16.3.8 | App Router, dev server, production build |
| React / React DOM | 19.2.8 | UI |
| TypeScript | ^5 | Type safety |
| Tailwind CSS | ^4 | Styling |
| ESLint | ^9 | Linting |
| tsx / puppeteer-core | dev | Test runners |

### AI model
| Component | Value |
|---|---|
| Model package | `buffalo_l` (SCRFD detector + ArcFace recognition) |
| Embedding dimension | **512** (verified from the ONNX output graph) |
| Similarity | Cosine (embeddings L2-normalised → cosine = dot product) |
| Inference providers | CPU (default), CUDA / CoreML optional |
| Weights location | `~/.insightface/models/` (auto-downloaded once, ~275 MB) |

### Database — MongoDB
| Aspect | Detail |
|---|---|
| Driver | PyMongo 4.10.1 (synchronous, single shared client) |
| Deployments | MongoDB Atlas (M0 free tier is enough) or a local server |
| Containers | **None — Docker is not used anywhere in this project** |
| Vector search | Native `$vectorSearch` (cosine, `numDimensions: 512`, filtered by `schoolId`) when supported; otherwise exact cosine in Python |

---

## 7. Data Model

| Collection | Purpose | Key constraints |
|---|---|---|
| `schools` | One document per school | `_id` is the school id |
| `students` | Student registry | **Unique (`schoolId`, `rollNumber`)** |
| `face_embeddings` | One doc per registered photo | Indexed on `schoolId`, `studentId` |
| `attendance` | One row per student/class/date | **Unique (`schoolId`, `studentId`, `className`, `section`, `attendanceDate`)** |
| `attendance_audit` | Append-only change trail | Indexed on `attendanceId`, `studentId` |
| `counters` | Internal integer id allocation | Keeps public ids numeric |

### Document shapes

```jsonc
// students
{
  "_id": "…",  "schoolId": "default",  "studentId": 1,
  "rollNumber": "101", "name": "Rahul Sharma",
  "className": "8", "section": "A",
  "createdAt": "…", "updatedAt": "…"
}

// face_embeddings   (many per student)
{
  "_id": "…",  "schoolId": "default",  "faceId": 1,  "studentId": 1,
  "embedding": [/* 512 floats, L2-normalised */],
  "detScore": 0.93, "createdAt": "…"
}

// attendance
{
  "_id": "…",  "schoolId": "default",  "attendanceId": 1,  "studentId": 1,
  "className": "8", "section": "A",
  "attendanceDate": "2026-10-01",  "status": "present",
  "confidence": 0.93, "createdAt": "…", "updatedAt": "…"
}
```

**Public ids are integers** (`student_id`, `face_id`, `attendance_id`) to keep
the API contract stable; internally they are allocated atomically from the
`counters` collection.
---

## 8. API Reference

Base URL: `http://127.0.0.1:8000` · Docs: `/docs` · 18 operations.

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/` | public | Service banner |
| GET | `/health` | public | Liveness, model readiness, storage status, counts |
| GET | `/api/students` | teacher | List students (filter by class/section, paginated) |
| POST | `/api/students` | admin | Register a student |
| GET | `/api/students/classes` | teacher | Distinct classes/sections with head-counts |
| GET | `/api/students/{id}` | teacher | Get one student |
| PATCH | `/api/students/{id}` | admin | Update student details |
| DELETE | `/api/students/{id}` | admin | Delete student + all biometrics + attendance |
| POST | `/api/students/{id}/faces` | admin | Register one face photo |
| GET | `/api/students/{id}/faces` | teacher | Embedding metadata (**never vectors**) |
| DELETE | `/api/students/{id}/faces` | admin | Delete all embeddings for a student |
| DELETE | `/api/students/{id}/faces/{face_id}` | admin | Delete one embedding |
| POST | `/api/recognition/recognize` | teacher | Recognise a classroom photo (writes nothing) |
| POST | `/api/attendance/process` | teacher | Classroom photo → attendance rows |
| GET | `/api/attendance` | teacher | Register for a class (optional date) + summary |
| GET | `/api/attendance/{id}` | teacher | One attendance row |
| PATCH | `/api/attendance/{id}` | teacher | Manually correct a status (audited) |
| GET | `/api/attendance/{id}/audit` | teacher | Audit trail for one row |

### Security
Two API-key tiers sent via the `X-API-Key` header:

| Key | Grants |
|---|---|
| `ADMIN_API_KEY` | Student CRUD + face-photo (biometric) management |
| `TEACHER_API_KEY` | Reads, recognition, attendance, manual corrections |

Keys are compared in constant time. With both keys empty the API runs
unauthenticated (development only) — `ENVIRONMENT=production` **refuses to
start** without keys and without a database.

---

## 9. Error Contract

Every failure returns `{"detail": "<human sentence>", "code": "<stable code>"}`.
Internal stack traces are logged server-side and never sent to clients.

| Status | Codes |
|---|---|
| 400 | `invalid_image`, `no_face_detected`, `multiple_faces_detected`, `face_too_small`, `too_many_faces`, `invalid_attendance_status` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `student_not_found`, `attendance_not_found` |
| 409 | `duplicate_roll_number`, `duplicate_face` |
| 413 | `payload_too_large` |
| 422 | `invalid_request` |
| 500 | `model_unavailable`, `internal_error` |
| 503 | `service_unavailable` |

---

## 10. Configuration

All settings come from environment variables / `backend/.env`. Nothing is
hard-coded; **`.env` is gitignored and must never be committed**.

| Variable | Default | Meaning |
|---|---|---|
| `ENVIRONMENT` | `development` | `development` / `production` |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
| `ADMIN_API_KEY` / `TEACHER_API_KEY` | *(empty)* | Auth keys; empty = auth disabled |
| `CORS_ORIGINS` | `localhost:3000,127.0.0.1:3000` | Allowed browser origins |
| `MONGODB_URI` | *(empty)* | Connection string; empty ⇒ in-memory store |
| `MONGODB_DATABASE` | `ai_attendance` | Database name (no spaces or `. / \ " $`) |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | `5000` | Server selection timeout |
| `SCHOOL_ID` | `default` | School all data is scoped to |
| `SCHOOL_NAME` | `Default School` | Display name for that school |
| `EMBEDDING_DIM` | `512` | Embedding vector length |
| `UPLOAD_DIR` | `uploads` | Temporary upload directory |
| `MAX_UPLOAD_SIZE_MB` | `10` | Upload size limit |
| `FACE_MATCH_THRESHOLD` | `0.45` | Cosine accept threshold (not a probability) |
| `FACE_MATCH_MARGIN` | `0.05` | Minimum lead over the best other student (0 = gate off) |
| `FACE_MODEL_NAME` | `buffalo_l` | Model package |
| `FACE_MODEL_ROOT` | `~/.insightface` | Weight cache location |
| `FACE_DET_SIZE` | `640` | Detector input size |
| `FACE_DET_THRESH` | `0.5` | Detector confidence floor |
| `FACE_MIN_FACE_SIZE` | `60` | Minimum face size in px |
| `FACE_PROVIDERS` | *(auto)* | Force an ONNX execution provider |
| `RECOGNITION_CANDIDATES` | `15` | Embeddings fetched per detected face |
| `MAX_FACES_PER_IMAGE` | `300` | Hard cap on faces per photo |
| `FACES_PER_STUDENT_MIN` / `MAX` | `3` / `10` | Recommended / maximum photos per student |
| `DUPLICATE_FACE_SIMILARITY` | `0.98` | Re-upload guard (keep very high) |
---

## 11. Important Interpretation Note

**Similarity scores are not probabilities.**

A reported `confidence` of `0.93` means "cosine similarity 0.93 between these
two face embeddings". It does **not** mean "93% probability this is that
student". Similarity scores are not calibrated, and the same score means
different things under different cameras, lighting and populations.

Accept/reject uses **two configurable gates**: the similarity threshold
(`FACE_MATCH_THRESHOLD`) *and* the identification margin
(`FACE_MATCH_MARGIN`), which requires the winner to lead the best candidate
from a *different* student by a minimum gap — a look-alike scoring 0.51 while
the runner-up scores 0.49 is reported as unknown, not accepted. Both are tuned
on your own data (`scripts/evaluate_recognition.py`); the defaults 0.45 and
0.05 are starting points, not production values. Every detection's raw
scores (best, runner-up, margin, decision) are exposed in the recognition
response as `match_details` so decisions can be audited.

---

## 12. Privacy, Security & Compliance

- **Face embeddings are sensitive biometric data.** They are stored in MongoDB
  but **never returned by any API endpoint** — the API exposes only metadata
  (`det_score`, timestamps).
- **Raw images are never persisted.** They are decoded in memory and discarded.
- All biometric-management endpoints require the **admin** key.
- Every attendance modification is written to an append-only audit trail.
- Delete-student also deletes all associated biometric data.
- **Model licence:** the pretrained `buffalo_l` weights are released for
  **non-commercial research use only**. Verify licensing before any commercial
  deployment.
- Credentials live only in `.env` (gitignored). Rotate the database password if
  it is ever shared.

---

## 13. Project Structure

```
backend/
├── app/
│   ├── main.py                     # FastAPI app + lifespan (model load, DB init)
│   ├── api/                        # health · students · recognition · attendance
│   │   └── dependencies.py         # upload validation, model-readiness guard
│   ├── core/
│   │   ├── config.py               # pydantic-settings + logging
│   │   ├── security.py             # API-key auth, admin/teacher roles
│   │   └── errors.py               # AppError hierarchy + error contract
│   ├── database/
│   │   ├── repository.py           # abstract AttendanceRepository + backend factory
│   │   ├── mongo_connection.py     # client singleton, index bootstrap, health
│   │   ├── mongo_repository.py     # MongoDB backend
│   │   ├── memory_repository.py    # in-memory backend (dev/demo)
│   │   └── records.py              # framework-free dataclasses
│   ├── schemas/                    # Pydantic request/response models
│   └── services/
│       ├── face_service.py         # InsightFace wrapper: detect + embed
│       ├── embedding_service.py    # registration rules
│       ├── matching_service.py     # threshold + duplicate removal
│       └── attendance_service.py   # photo → attendance rows
├── scripts/
│   ├── init_mongo.py               # create collections + indexes
│   ├── test_recognition.py         # end-to-end recognition (no HTTP)
│   ├── evaluate_recognition.py     # threshold tuning
│   └── make_demo_dataset.py        # generate test images
└── requirements.txt

frontend/
├── app/                            # page.tsx · students · recognition · attendance
├── components/                     # Nav · ui · FacePanel
├── lib/                            # api.ts (client) · types.ts (mirrors schemas)
└── scripts/                        # api-smoke.ts · ui-smoke.mjs
```

---

## 14. Setup & Running

**No Docker is required.** No `docker-compose.yml`, no `Dockerfile`.

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate                 # bash: source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env                   # set MONGODB_URI (optional)
python scripts/init_mongo.py           # only if using MongoDB
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev                            # http://localhost:3000
```

Without `MONGODB_URI` the app boots with in-memory storage and no API keys —
convenient for demos, but all data is lost on restart.
---

## 15. Testing

| Suite | Command | Scope |
|---|---|---|
| API contract (38 checks) | `npm run test:api` | Drives the real frontend client against a live backend |
| Browser smoke (27 checks) | `npm run test:ui` | All four screens, no console errors |
| Lint + types | `npm run lint` / `npm run typecheck` | Code quality |
| Recognition pipeline | `python scripts/test_recognition.py` | Registers students, recognises classroom photos, prints scores |
| Threshold tuning | `python scripts/evaluate_recognition.py` | Sweeps thresholds to recommend `FACE_MATCH_THRESHOLD` |

Bundled demo data: 6 students (rolls 101–106) with 3 photos each, 3 classroom
photos including one with an unknown person, plus a held-out evaluation set.

**Latest verified result:** 38/38 API contract checks passing, 12/13 classroom
faces recognised, unknown person correctly rejected at similarity 0.15 against
the 0.45 threshold.

---

## 16. Current Status & Known Limitations

### Completed
Student registration · face registration · embedding generation · recognition ·
attendance processing · attendance history · manual correction · audit trail ·
MongoDB persistence with indexes · school-scoped data isolation · vector search
with fallback · Docker-free setup.

### Known limitations
- **Multi-school is data-level only.** A single school is configured per process
  via `SCHOOL_ID`. Every query is scoped and cross-school leakage is
  impossible, but there is no HTTP API for selecting a school per request —
  adding one would change response shapes.
- **MongoDB `$vectorSearch` requires Atlas** (or self-managed `mongot`). On a
  plain local `mongod` the repository falls back to exact cosine similarity,
  which returns identical results at this data size.
- **No user accounts.** Auth is API-key based (admin/teacher); there is no
  login, session or per-user identity model.
- No pagination UI — the student list requests `limit=200` (API supports 500).
- Recognition boxes are drawn for matched faces only; unmatched faces are
  reported as a count.
- Not a PWA and not offline-capable; every action needs the backend reachable.
- `npm run dev` needs a working WebSocket; behind a proxy that blocks
  `ws://localhost` use `npm run build && npm start`.

---

## 17. Future Requirements

- **Model independence.** The database stores embeddings, not the model, so the
  pretrained `buffalo_l` model can later be replaced by an in-house model
  without changing the MongoDB structure (update `EMBEDDING_DIM` and recreate
  the vector index).
- Per-school API selection and cross-school administration.
- Real user accounts (replacing API keys) with hashed credentials.
- Attendance analytics, export and per-student history.
- Camera/video-stream input for live attendance.
not by the caller.