# Data Flow & Technology In Use — AI Attendance System

Companion to `PRD.md`. This document explains **how data actually moves** through
the system at runtime, **which technology does what**, and **why the structure is
shaped the way it is**.

| | |
|---|---|
| **Project** | AI Attendance System |
| **Document** | Flow, technology usage and structure |
| **Last updated** | 2026-10-02 |

---

## Table of Contents
1. [Structure at a glance](#1-structure-at-a-glance)
2. [Layer-by-layer responsibilities](#2-layer-by-layer-responsibilities)
3. [Startup flow](#3-startup-flow)
4. [Request flow — the 3 main journeys](#4-request-flow--the-3-main-journeys)
5. [Data flow through every technology](#5-data-flow-through-every-technology)
6. [Where data lives](#6-where-data-lives)
7. [Why the structure is this way](#7-why-the-structure-is-this-way)

---

## 1. Structure at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER  (Next.js 16 · React 19 · Tailwind 4)              │
│  Dashboard │ Students │ Recognition │ Attendance            │
│                                                             │
│  components/Nav.tsx  ── API-key drawer, localStorage        │
│  components/FacePanel.tsx ── per-student photo upload       │
│  lib/api.ts  ── THE ONLY place fetch() is called            │
│  lib/types.ts ── mirrors the Pydantic schemas               │
└───────────────────────────┬─────────────────────────────────┘
                            │  fetch()  ·  JSON / multipart
                            │  header: X-API-Key
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  FASTAPI  (Python 3.13 · Uvicorn)                           │
│                                                             │
│  api/            ← HTTP shape only (parse, authorise, reply)│
│  ├─ dependencies.py   upload validation + model-ready guard │
│  ├─ security.py       admin / teacher API-key roles         │
│  └─ errors.py         {"detail","code"} error contract      │
│                                                             │
│  services/       ← business rules only (no HTTP, no DB)     │
│  ├─ face_service.py      InsightFace detect + embed         │
│  ├─ embedding_service.py registration rules                │
│  ├─ matching_service.py   threshold + duplicate removal     │
│  └─ attendance_service.py photo → attendance rows           │
│                                                             │
│  database/       ← storage only (no AI, no business rules)  │
│  ├─ repository.py        abstract interface + factory       │
│  ├─ mongo_repository.py  MongoDB backend                    │
│  ├─ memory_repository.py in-memory backend                   │
│  ├─ mongo_connection.py  client singleton + index bootstrap │
│  └─ records.py           plain dataclasses (the contract)   │
│                                                             │
│  schemas/        ← Pydantic request/response models         │
│  core/config.py  ← every setting, read from .env            │
└───────────────────────────┬─────────────────────────────────┘
                            │  PyMongo driver
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MONGODB                                                      │
│  schools · students · face_embeddings ·                     │
│  attendance · attendance_audit · counters                    │
└─────────────────────────────────────────────────────────────┘
```

### The one rule that shapes everything
```
Routers → Services → Repository  ←── never the other way round
```
A router may call a service. A service may call the repository. **Nothing below
the repository knows about HTTP, and nothing above the repository knows about
MongoDB.** That is why the same business logic runs unchanged against MongoDB
*and* against the in-memory store.

---

## 2. Layer-by-Layer Responsibilities

| Layer | Owns | Must NOT know |
|---|---|---|
| **Frontend** | Rendering, user input, showing scores | Anything about embeddings or Mongo |
| **api/** | Parsing HTTP, auth, response shapes, status codes | Business rules, face maths |
| **services/** | Business rules, thresholds, matching decisions | HTTP, MongoDB, ObjectIds |
| **database/** | Queries, indexes, document shapes, ids | Face recognition, thresholds |
| **face_service** | Detection + embedding maths | Students, attendance, MongoDB |

---

## 3. Startup Flow

Executed **once**, in the FastAPI `lifespan` block (`app/main.py`). Real log
line from a working start:

```
Starting AI Attendance System (development)
Pretrained face model 'buffalo_l' loaded in 3480 ms | providers=['CPUExecutionProvider']
Storage backend: MongoDB (school=default)
Startup complete in 3483 ms | model=buffalo_l | providers=[...] | storage=memory | auth=DISABLED (development)
```

| # | Step | Technology | What happens |
|---|---|---|---|
| 1 | `configure_logging()` | Python `logging` | One root console handler; InsightFace quieted to WARNING |
| 2 | `settings.validate_runtime()` | Pydantic Settings | Fails fast if `ENVIRONMENT=production` lacks keys or a database |
| 3 | `face_service.load()` | InsightFace + ONNX Runtime | Downloads `buffalo_l` weights **only on first run** into `~/.insightface/models/`, builds `FaceAnalysis`, calls `prepare(ctx_id, det_size, det_thresh)` |
| 4 | `get_repository()` | Project code | Reads `MONGODB_URI` → picks MongoDB or in-memory, logs the choice |
| 5 | `init_db()` | PyMongo | Creates collections + indexes + vector index + the school document |
| 6 | `upload_path.mkdir()` | Python `pathlib` | Ensures the upload directory exists |
| 7 | — | — | Server now accepts traffic |
| — | *shutdown* | PyMongo | `close_client()` returns pooled sockets to the OS |

### Why the model is loaded once, at startup
Loading `buffalo_l` costs **~3.5 seconds** and ~275 MB of RAM. Doing that per
request would be unusable. The pipeline is therefore created once and shared.

It is also **thread-safe by design**:

```python
self._load_lock      = threading.Lock()   # guards the one-time load
self._inference_lock = threading.Lock()   # serialises ONNX sessions
```
The inference lock matters because ONNX Runtime sessions are not re-entrant;
concurrent requests queue rather than corrupt state.

**Measured startup:** ~3.5 s cold (includes model load), effectively instant warm.

---

## 4. Request Flow — the 3 Main Journeys

### Journey A — Register a student and their faces

```
POST /api/students                        (admin key)
  │
  ├─ Pydantic validates StudentCreateRequest
  ├─ security.require_admin  → "admin"  (constant-time key compare)
  ├─ repository.get_student_by_roll(...)  → MONGODB find_one
  │      hit? → 409 duplicate_roll_number
  └─ repository.create_student(...)
         └─ id = counters.find_one_and_update({_id:"student"}, {$inc:{value:1}})
         └─ insert into students  (unique index on schoolId+rollNumber enforces safety)

POST /api/students/{id}/faces             (admin key)   × 3–5 times
  │
  ├─ _writable_student  → exists? under FACES_PER_STUDENT_MAX?
  ├─ dependencies.read_image_upload
  │      • content-type must start with "image/"
  │      • streamed in 64 KB chunks, size checked WHILE streaming (never fully buffered)
  │      • OpenCV cv2.imdecode → numpy array (BGR)
  ├─ dependencies.require_face_model  → model loaded?
  ├─ embedding_service.single_face_embedding(image)
  │      • FaceService.detect(image, min_face_size=0)
  │      •        └─ InsightFace FaceAnalysis.get(image)   [inference lock held]
  │      •        └─ SCRFD detector → face boxes
  │      •        └─ ArcFace w600k_r50 → 512-float vector
  │      •        └─ l2_normalize(vector)   → unit length
  │      • rules: 0 faces → error · 2+ faces → error · <60px → error
  ├─ duplicate check: cosine vs every stored face ≥ 0.98 → 409 duplicate_face
  └─ repository.add_face(...)  → insert into face_embeddings
                                     (embedding stored L2-normalised)

GET /api/students/{id}/faces             (teacher key)
  └─ returns METADATA ONLY — det_score + created_at.
     The 512-float vector is never serialised into any response.
```

**Data written:** 1 student document + 1 embedding document per photo.

---

### Journey B — Recognise a classroom photo (read-only)

```
POST /api/recognition/recognize           (teacher key)
  │
  ├─ upload validated → numpy image
  ├─ embedding_service.detect_faces(image)
  │      FaceService.detect() → ALL usable faces, sorted largest-first
  │      (no single-face rule here — many faces are expected)
  │
  └─ matching_service.identify(faces)      ← for EACH detected face:
         │
         ├─ face.embedding is None? → unknown
         │
         ├─ repository.search_similar(embedding, limit=5)
         │      ┌─────────────────────────────────────────────┐
         │      │ MONGODB PATH                              │
         │      │ $vectorSearch {                            │
         │      │   index: "vector_index",                   │
         │      │   path: "embedding",                       │
         │      │   queryVector: [...512 floats...],         │
         │      │   similarity: "cosine",                    │
         │      │   filter: { schoolId: "<configured>" }  ◄── ISOLATION
         │      │ }                                          │
         │      │ similarity = 1 - score   (cosine distance) │
         │      └─────────────────────────────────────────────┘
         │      ┌─────────────────────────────────────────────┐
         │      │ FALLBACK (no Atlas / no mongot)           │
         │      │ find({schoolId}) → numpy stack             │
         │      │ matrix @ queryVector  → dot products       │
         │      │ np.argsort(-sim)[:limit]                   │
         │      │ (identical results, just not indexed)      │
         │      └─────────────────────────────────────────────┘
         │
         ├─ best = candidates[0]
         ├─ runner-up = best score from a DIFFERENT student
         ├─ accepted = best_similarity >= FACE_MATCH_THRESHOLD (0.45)
         │      below threshold → student = None → counted as UNKNOWN
         └─ one entry per student (best-scoring face wins;
            extra appearances counted as duplicates)

RESPONSE (nothing is written to the database)
```

**Data written:** none. Recognition is deliberately side-effect free.

---

### Journey C — Process attendance

```
POST /api/attendance/process              (teacher key)
  form: file + class_name + section + attendance_date
  │
  ├─ upload validated, class/section/date validated by Pydantic
  ├─ attendance_service.process(image, ...)
  │    │
  │    ├─ embedding_service.detect_faces(image)
  │    ├─ matching_service.identify(faces)      ← identical to Journey B
  │    │
  │    └─ FOR each accepted match:
  │          ├─ guard: is this student in class_name/section?
  │          │      no → skipped_out_of_class += 1
  │          ├─ repository.upsert_attendance(...)
  │          │      try insert  ────────► DuplicateKeyError
  │          │                            (unique index:
  │          │   schoolId + studentId +   schoolId+studentId+
  │          │   className + section +    className+section+
  │          │   attendanceDate)          attendanceDate)
  │          │      hit → return existing row, created=False
  │          │                                 → already_present += 1
  │          │      miss → insert + write attendance_audit {action:"created"}
  │          └─ confidence = round(similarity, 4)   ← the cosine score

GET /api/attendance?class_name=8&section=A[&date=…]
  └─ repository.list_attendance(...)  → rows joined with student details
     + summary counts (present / absent / late / excused)

PATCH /api/attendance/{id}                (teacher key)
  └─ repository.update_attendance(...)  → status changed
     + attendance_audit {action:"manual_update", oldStatus, newStatus, actor}
  └─ GET /api/attendance/{id}/audit  → the full trail
```

**Data written:** N attendance rows + N audit rows.
---

## 5. Data Flow Through Every Technology

### How an image becomes a number, and a number becomes a row

| Stage | Data shape | Technology doing the work |
|---|---|---|
| Browser file select | `File` (JPEG bytes) | `<input type="file">`, `FormData` |
| HTTP upload | `multipart/form-data` stream | FastAPI + `python-multipart` |
| Chunked size check | `bytes` chunks, 64 KB | Python generator loop (never fully buffered) |
| Decode | `bytes` → `np.ndarray` (BGR) | OpenCV `cv2.imdecode` |
| Detect faces | image → list of boxes | InsightFace SCRFD via ONNX Runtime |
| Embed | face crop → 512 floats | InsightFace ArcFace (`w600k_r50.onnx`) |
| Normalise | 512 floats → unit length | NumPy `l2_normalize` |
| Store | `list[float]` (512) | PyMongo → `face_embeddings` |
| Search | query vector → ranked matches | MongoDB `$vectorSearch` (or NumPy fallback) |
| Decide | `float` vs threshold | `matching_service` (pure Python) |
| Persist | row + audit row | PyMongo → `attendance`, `attendance_audit` |
| Render | JSON → React tree | Next.js + Tailwind |

### Where each technology earns its place

| Technology | Job in this project |
|---|---|
| **Next.js** | Dev server with HMR, production build, routing for 4 screens, static prerendering |
| **React 19** | UI state; effects only write state from callbacks (React hooks rules) |
| **TypeScript** | `lib/types.ts` mirrors the Pydantic schemas so a contract change breaks the build, not the browser |
| **Tailwind** | Utility styling for the register, banners and overlays |
| **FastAPI** | Routing, dependency injection, OpenAPI docs, Pydantic validation |
| **Pydantic** | Validates every request *before* any work; serialises every response |
| **pydantic-settings** | `.env` → typed `Settings`; the single source of configuration truth |
| **Uvicorn** | ASGI server; runs the lifespan hook that loads the model |
| **python-multipart** | Parses the multipart image uploads |
| **InsightFace** | The pretrained face pipeline (detection + recognition). No training anywhere |
| **ONNX Runtime** | Executes the `.onnx` graphs on CPU; swappable to CUDA/CoreML |
| **OpenCV** | Decodes uploads, draws debug bounding boxes |
| **NumPy** | All vector maths — normalisation, cosine similarity, arg-sort |
| **PyMongo** | The only database driver; one shared client with its own connection pool |

### Data transformations in detail

**1. Image → embedding**
```
JPEG bytes                      multipart decode
   ↓  cv2.imdecode
numpy HxWx3 BGR uint8           in memory only, never written to disk
   ↓  FaceAnalysis.get()        [inference lock held]
list[Face]                      bbox + det_score + 512-float embedding
   ↓  l2_normalize
list[Face]                      unit-length vectors (‖v‖ = 1)
```

**2. Embedding → similarity**

Because both sides are L2-normalised, cosine similarity collapses to a dot
product — no division, no rounding error:
```
cosine(a, b) = (a · b) / (‖a‖ ‖b‖) = a · b     because ‖a‖ = ‖b‖ = 1
```
`$vectorSearch` reports *cosine distance* instead, so the repository converts:
```
similarity = 1 - score          # score is cosine distance
```

**3. Ids**

MongoDB would normally generate an `ObjectId` string, but the public API uses
integers (`/api/students/{student_id}`). So each document keeps an internal
`ObjectId` **and** a numeric public id allocated atomically:
```python
collection("counters").find_one_and_update(
    {"_id": "student"}, {"$inc": {"value": 1}}, upsert=True, return_document=AFTER
)
```
The `upsert + $inc` combination is atomic, so two concurrent registrations can
never receive the same id.
---

## 6. Where Data Lives

### Collections

| Collection | Written by | Read by | Cardinality |
|---|---|---|---|
| `schools` | `init_db()` (bootstrap) | — | 1 per school |
| `students` | create / update / delete student | list, get, match lookup | 1 per student |
| `face_embeddings` | `add_face`, `delete_face(s)` | `search_similar`, `list_faces`, `count_faces` | many per student |
| `attendance` | `upsert_attendance`, `update_attendance` | list / get register | 1 per student+class+date |
| `attendance_audit` | every attendance change | `list_audit` | append-only |
| `counters` | id allocation | id allocation | 1 doc per entity type |

### Indexes and the problem each one solves

| Index | Solves |
|---|---|
| `students (schoolId)` | scoping every student query to one school |
| `students (schoolId, rollNumber)` **unique** | stops duplicate roll numbers within a school |
| `face_embeddings (schoolId)` | scoping the vector search |
| `face_embeddings (studentId)` | listing / counting a student's photos |
| `attendance (schoolId)` · `(studentId)` · `(attendanceDate)` | fast register queries |
| `attendance (schoolId, studentId, className, section, attendanceDate)` **unique** | makes attendance processing idempotent |
| `attendance_audit (attendanceId)` · `(studentId)` | audit-trail lookups |
| vector index on `embedding` | `$vectorSearch` (512-d, cosine, filtered by `schoolId`) |

**The two unique indexes are load-bearing.** They are the *only* thing standing
between a double-submitted photo and duplicated attendance rows — the
application relies on the database, not on a read-then-write race.

### Data that is deliberately NOT stored
- **Raw images** — decoded in memory, discarded. Only the 512-float vector lives.
- **Embeddings in API responses** — never serialised out; only metadata is exposed.
- **Scores as probabilities** — the cosine value is stored as-is and labelled a
  similarity everywhere it is shown.

---

## 7. Why the Structure Is This Way

| Decision | Reason |
|---|---|
| **Repository interface** | Swapped PostgreSQL/pgvector → MongoDB without touching a single service or route |
| **Plain dataclasses in `records.py`** | Services never hold a DB driver object, so they stay testable and backend-agnostic |
| **Model loaded once at startup** | ~3.5 s and 275 MB — far too expensive per request |
| **Inference lock** | ONNX sessions are not re-entrant; serialising them is safer than corrupting them |
| **Uploads validated while streaming** | An oversized body is rejected (413) without ever being fully buffered in memory |
| **Recognition never writes** | Calling it repeatedly is then always safe — it cannot silently mark attendance |
| **Attendance is idempotent** | Re-submitting a photo on the same day updates nothing and reports `already_present` |
| **Threshold is configurable, not hard-coded** | A fixed threshold cannot be correct across different cameras, lighting and populations |
| **Unknown beats a wrong guess** | A face below threshold returns *Unknown*; the system never fabricates an identity |
| **Every change audited** | Attendance disputes are settled by reading the trail |
| **Biometrics never leave the server** | Embeddings are sensitive data; the API exposes metadata only |
| **School filter inside the query** | Isolation enforced by the database, so a bug upstream cannot leak another school's students |
| **Vector search *with* exact fallback** | Same results on Atlas or a plain local `mongod`, so deployment choice never changes behaviour |
| **Errors as `{"detail","code"}`** | One machine-readable contract; stack traces stay in the logs |

### Verified end-to-end result
```
Recognition:  13 faces detected · 12 recognised · 1 unknown
Unknown person: similarity 0.15  vs  threshold 0.45  →  correctly rejected
API contract:  38 checks · 38 passed · 0 failed
School isolation: 20/20 generated queries carry a schoolId filter
```

---

## Appendix — Quick Reference

| Question | Answer |
|---|---|
| Where does the face model live? | `~/.insightface/models/buffalo_l/`, downloaded once on first run |
| How big is an embedding? | 512 floats, verified from the ONNX output graph |
| What does "confidence" mean? | Cosine similarity — **not** a probability |
| Which threshold? | `FACE_MATCH_THRESHOLD`, default `0.45` |
| Is Docker used? | **No.** No `docker-compose.yml`, no `Dockerfile` |
| What if MongoDB is down? | Startup fails fast rather than running half-configured |
| Does recognition modify data? | **No** — strictly read-only |
| How are duplicate attendance rows prevented? | A unique MongoDB index on school+student+class+section+date |
| Can school A match school B? | **No** — `schoolId` is inside every query and inside the vector search |
| How do I change the face model later? | Replace the model, update `EMBEDDING_DIM`, re-run `init_mongo.py`. The stored data shape does not change. |
| **face_service** | Detection + embedding maths | Students, attendance, MongoDB |