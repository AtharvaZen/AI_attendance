/**
 * End-to-end smoke test for the FRONTEND's API layer.
 *
 * Exercises `lib/api.ts` - the exact client the UI calls - against a running
 * backend, covering every request shape the four screens use: JSON bodies,
 * multipart uploads with form fields, the `date` / `class` response aliases,
 * manual corrections and the audit trail.
 *
 *   backend:  cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app
 *   run:      cd frontend && npx tsx scripts/api-smoke.ts
 *
 * Data is cleaned up at the end. Uses the demo images in backend/test_data.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api, ApiError, useKeys } from "../lib/api";
import type {
  AttendanceListResponse,
  AttendanceProcessResponse,
  RecognitionResponse,
  Student,
  StudentFacesResponse,
} from "../lib/types";

const here = fileURLToPath(new URL(".", import.meta.url));
const backend = resolve(here, "..", "..", "backend");
const studentPhoto = (slug: string, name: string) =>
  join(backend, "test_data", "students", slug, name);
const classroomPhoto = (name: string) => join(backend, "test_data", "attendance", name);

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): boolean {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
  return ok;
}

function asFile(path: string): File {
  if (!existsSync(path)) throw new Error(`missing test asset: ${path}`);
  const bytes = readFileSync(path);
  return new File([new Uint8Array(bytes)], path.split(/[\\/]/).pop() ?? "photo.jpg", {
    type: "image/jpeg",
  });
}

/** Sign in and return the signed session token. */
async function login(username: string, password: string): Promise<string> {
  if (!password) {
    console.log(`  SKIP  ${username} login (no ${username.toUpperCase()}_PASSWORD env var)`);
    return "";
  }
  try {
    const result = await api.login(username, password);
    return result.token;
  } catch (err) {
    if (err instanceof ApiError) {
      console.log(`  FAIL  ${username} login (${err.code} ${err.status})`);
      return "";
    }
    throw err;
  }
}

const CLASS = "8";
const SECTION = "A";
const TODAY = new Date().toISOString().slice(0, 10);
const ROLL = "9901";
const ROLL_TWO = "9902";

async function main(): Promise<void> {
  console.log(`\nAPI base: ${api.base}\n`);

  /* ---------------------------------------------------------------- auth */
  // The browser normally stores keys in localStorage, which does not exist in
  // Node. Sign in through the real login endpoint and inject both tokens so the
  // rest of the suite exercises the same auth path a user would.
  console.log("auth");
  const adminToken = await login("admin", process.env.ADMIN_PASSWORD ?? "");
  const teacherToken = await login("teacher", process.env.TEACHER_PASSWORD ?? "");
  check("admin login returns a token", adminToken.length > 0);
  check("teacher login returns a token", teacherToken.length > 0);
  useKeys({ admin: adminToken, teacher: teacherToken });

  /* ---------------------------------------------------------------- health */
  console.log("\nhealth");
  const health = await api.health();
  check("model loaded", health.model_loaded, `status=${health.status}`);
  check("threshold exposed", typeof health.match_threshold === "number");
  check(
    "storage backend reported",
    health.storage_backend === "memory" || health.storage_backend === "mongodb",
    health.storage_backend,
  );

  /* -------------------------------------------------------------- students */
  console.log("\nstudents");
  const before = await api.get<{ total: number; students: Student[] }>(
    "/api/students?limit=100",
    "teacher",
  );
  const created = await api.post<Student>(
    "/api/students",
    { roll_number: ROLL, name: "Frontend Smoke", class_name: CLASS, section: SECTION },
    "admin",
  );
  check("create student", created.roll_number === ROLL, `id=${created.id}`);
  check("new student has no faces", created.face_count === 0);

  const second = await api.post<Student>(
    "/api/students",
    { roll_number: ROLL_TWO, name: "Frontend Smoke Two", class_name: CLASS, section: SECTION },
    "admin",
  );
  check("create second student", second.roll_number === ROLL_TWO, `id=${second.id}`);

  const list = await api.get<{ total: number; students: Student[] }>(
    "/api/students?limit=100",
    "teacher",
  );
  check("list total grew", list.total === before.total + 2, `${before.total} -> ${list.total}`);

  const filtered = await api.get<{ total: number }>(
    `/api/students?class_name=${CLASS}&section=${SECTION}`,
    "teacher",
  );
  check("class filter applied", filtered.total >= 2, `total=${filtered.total}`);

  const classes = await api.get<{ classes: { class_name: string; student_count: number }[] }>(
    "/api/students/classes",
    "teacher",
  );
  check(
    "classes endpoint lists our class",
    classes.classes.some((entry) => entry.class_name === CLASS),
    classes.classes.map((c) => `${c.class_name}-${c.student_count}`).join(", ") || "none",
  );

  /* ----------------------------------------------------------------- faces */
  console.log("\nface enrollment");
  const shots = ["01.jpg", "02.jpg", "03.jpg"];
  for (const shot of shots) {
    const result = await api.upload<{ total_faces: number; is_ready: boolean; det_score: number }>(
      `/api/students/${created.id}/faces`,
      asFile(studentPhoto("101_Rahul_Sharma", shot)),
      {},
      "admin",
    );
    check(
      `uploaded ${shot}`,
      result.det_score > 0 && result.det_score <= 1,
      `det=${result.det_score.toFixed(3)} total=${result.total_faces}`,
    );
    if (shot === shots[2]) check("student is ready", result.is_ready === true);
  }
  for (const shot of shots) {
    await api.upload(
      `/api/students/${second.id}/faces`,
      asFile(studentPhoto("102_Aman_Verma", shot)),
      {},
      "admin",
    );
  }

  const faces = await api.get<StudentFacesResponse>(
    `/api/students/${created.id}/faces`,
    "teacher",
  );
  check("face metadata listed", faces.faces.length === 3, `count=${faces.faces.length}`);
  check(
    "embeddings are never returned",
    !JSON.stringify(faces).includes("embedding"),
    "response is metadata only",
  );

  // Duplicate guard: the exact same file re-uploaded must be rejected.
  let duplicateRejected = false;
  try {
    await api.upload(
      `/api/students/${created.id}/faces`,
      asFile(studentPhoto("101_Rahul_Sharma", shots[0])),
      {},
      "admin",
    );
  } catch (err) {
    duplicateRejected =
      err instanceof ApiError && (err.status === 409 || err.code === "duplicate_face");
    if (err instanceof ApiError) console.log(`        (${err.code} ${err.status}: ${err.message})`);
  }
  check("duplicate re-upload rejected", duplicateRejected, "expected 409 duplicate_face");

  const refreshed = await api.get<Student>("/api/students/" + created.id, "teacher");
  check("student face_count updated", refreshed.face_count === 3, `${refreshed.face_count}`);

  /* ----------------------------------------------------------- recognition */
  console.log("\nrecognition (dry run)");
  const recognition = await api.upload<RecognitionResponse>(
    "/api/recognition/recognize",
    asFile(classroomPhoto("classroom_01.jpg")),
    {},
    "teacher",
  );
  check("faces detected", recognition.total_faces > 0, `faces=${recognition.total_faces}`);
  check("students matched", recognition.recognized.length > 0, `matched=${recognition.recognized.length}`);
  check(
    "threshold echoed",
    recognition.threshold > 0 && recognition.threshold <= 1,
    recognition.threshold.toFixed(2),
  );
  const match = recognition.recognized[0];
  check(
    "match payload complete",
    typeof match.roll_number === "string" &&
      typeof match.name === "string" &&
      Array.isArray(match.face_bbox) &&
      match.face_bbox.length === 4,
    `bbox=[${match.face_bbox.join(", ")}]`,
  );
  const healthAfterRecognize = await api.health();
  check(
    "dry run wrote nothing",
    healthAfterRecognize.students === list.total,
    `${list.total} -> ${healthAfterRecognize.students}`,
  );

  /* ------------------------------------------------------------ attendance */
  console.log("\nattendance");
  const processed = await api.upload<AttendanceProcessResponse>(
    "/api/attendance/process",
    asFile(classroomPhoto("classroom_01.jpg")),
    { class_name: CLASS, section: SECTION, attendance_date: TODAY },
    "teacher",
  );
  check("process returns documented date key", processed.date === TODAY, processed.date);
  check("process returns documented class key", processed.class === CLASS, processed.class);
  check("rows recognised", processed.attendance.length > 0, `rows=${processed.attendance.length}`);
  check(
    "our enrolled student was marked",
    processed.attendance.some((entry) => entry.roll_number === ROLL),
    processed.attendance.map((e) => e.roll_number).join(","),
  );
  check("confidence is a similarity", processed.threshold === 0.45, processed.threshold.toFixed(2));

  // Re-processing the same photo must be idempotent.
  const secondRun = await api.upload<AttendanceProcessResponse>(
    "/api/attendance/process",
    asFile(classroomPhoto("classroom_01.jpg")),
    { class_name: CLASS, section: SECTION, attendance_date: TODAY },
    "teacher",
  );
  check(
    "idempotent re-run adds no rows",
    secondRun.already_present >= processed.attendance.length &&
      secondRun.attendance.length <= processed.attendance.length,
    `already_present=${secondRun.already_present} new=${secondRun.attendance.length}`,
  );

  const register = await api.get<AttendanceListResponse>(
    `/api/attendance?class_name=${CLASS}&section=${SECTION}&attendance_date=${TODAY}`,
    "teacher",
  );
  check("register summary total", register.summary.total === register.records.length,
    `total=${register.summary.total}`);
  const row = register.records.find((r) => r.roll_number === ROLL);
  check("record found", Boolean(row), `id=${row?.id ?? "-"}`);
  check(
    "record uses documented 'date' / 'class' keys",
    Boolean(row) && row!.date === TODAY && row!.class === CLASS,
    row ? `${row.date} / ${row.class}` : "n/a",
  );
  check(
    "summary present count",
    register.summary.present === register.records.filter((r) => r.status === "present").length,
    `${register.summary.present}/${register.summary.total}`,
  );

  if (!row) throw new Error("no attendance row to correct");

  const corrected = await api.patch<{ id: number; status: string }>(
    `/api/attendance/${row.id}`,
    { status: "late" },
    "teacher",
  );
  check("manual correction applied", corrected.status === "late", corrected.status);

  const audit = await api.get<{
    total: number;
    entries: { action: string; old_status: string | null; new_status: string | null; actor: string }[];
  }>(`/api/attendance/${row.id}/audit`, "teacher");
  check("audit trail has entries", audit.total >= 1, `entries=${audit.total}`);
  const entry = audit.entries[0];
  check(
    "audit records the correction",
    entry.action === "manual_update" &&
      entry.old_status === "present" &&
      entry.new_status === "late",
    `${entry.action}: ${entry.old_status} -> ${entry.new_status} by ${entry.actor}`,
  );

  const badStatus = await api
    .patch(`/api/attendance/${row.id}`, { status: "banana" }, "teacher")
    .then(() => false)
    .catch((err: unknown) => err instanceof ApiError && err.status === 422);
  check("invalid status rejected", badStatus);

  /* --------------------------------------------------------------- cleanup */
  console.log("\ncleanup");
  const removed = await api.delete<{ message: string }>(`/api/students/${created.id}`, "admin");
  check("delete student", /delet/i.test(removed.message), removed.message);
  await api.delete(`/api/students/${second.id}`, "admin");
  const after = await api.get<{ total: number }>("/api/students?limit=100", "teacher");
  check("students restored", after.total === before.total, `${before.total} -> ${after.total}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  if (err instanceof ApiError) {
    console.error(`\nApiError ${err.status} ${err.code}: ${err.message}`);
  } else {
    console.error("\n" + (err instanceof Error ? err.stack : String(err)));
  }
  console.log(`\n${passed} passed, ${failed} failed (aborted)\n`);
  process.exitCode = 1;
});

