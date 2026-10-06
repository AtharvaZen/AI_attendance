/**
 * Response types mirroring the FastAPI Pydantic schemas.
 *
 * Attendance responses are serialised with Pydantic `serialization_alias`, so
 * the wire keys are `date` and `class` (not `attendance_date` / `class_name`).
 */

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = [
  "present",
  "absent",
  "late",
  "excused",
];

/* ---------------------------------- health --------------------------------- */

export interface HealthResponse {
  status: "ok" | "starting";
  model_loaded: boolean;
  model: string;
  providers: string[];
  match_threshold: number;
  match_margin: number;
  environment: string;
  storage_backend: "memory" | "mongodb";
  database_connected: boolean;
  database_info: string;
  students: number;
  face_embeddings: number;
  auth_enabled: boolean;
}

/* --------------------------------- students -------------------------------- */

export interface Student {
  id: number;
  roll_number: string;
  name: string;
  class_name: string;
  section: string;
  face_count: number;
  created_at: string;
  updated_at: string;
}

export interface StudentListResponse {
  total: number;
  limit: number;
  offset: number;
  students: Student[];
}

export interface ClassSummary {
  class_name: string;
  section: string;
  student_count: number;
}

export interface ClassListResponse {
  classes: ClassSummary[];
}

export interface FaceUploadResponse {
  face_id: number;
  student_id: number;
  det_score: number;
  total_faces: number;
  is_ready: boolean;
  message: string;
}

export interface FaceMetadata {
  id: number;
  student_id: number;
  det_score: number;
  created_at: string;
}

export interface StudentFacesResponse {
  student_id: number;
  roll_number: string;
  name: string;
  total_faces: number;
  faces: FaceMetadata[];
}

export interface MessageResponse {
  message: string;
}

/* ------------------------------- recognition ------------------------------- */

export interface RecognizedStudent {
  student_id: number;
  roll_number: string;
  name: string;
  class_name: string;
  section: string;
  confidence: number;
  face_bbox: [number, number, number, number];
}

/** Per-face audit trail returned by POST /api/recognition/recognize. */
export interface FaceMatchDetail {
  face_index: number;
  bbox: [number, number, number, number];
  student_id: number | null;
  name: string | null;
  roll_number: string | null;
  best_similarity: number;
  second_best_similarity: number | null;
  margin: number | null;
  threshold: number;
  margin_threshold: number;
  decision: "match" | "duplicate" | "unknown";
}

export interface RecognitionResponse {
  total_faces: number;
  recognized: RecognizedStudent[];
  unknown_faces: number;
  duplicates_removed: number;
  threshold: number;
  margin_threshold?: number;
  match_details?: FaceMatchDetail[];
  processing_time_ms: number;
}

/* -------------------------------- attendance ------------------------------- */

export interface AttendanceEntry {
  student_id: number;
  roll_number: string;
  name: string;
  status: string;
  confidence: number;
}

export interface AttendanceProcessResponse {
  date: string;
  class: string;
  section: string;
  total_faces: number;
  recognized_students: number;
  unknown_faces: number;
  duplicates_removed: number;
  already_present: number;
  skipped_out_of_class: number;
  threshold: number;
  processing_time_ms: number;
  attendance: AttendanceEntry[];
}

export interface AttendanceRecord {
  id: number;
  student_id: number;
  roll_number: string;
  name: string;
  class: string;
  date: string;
  status: string;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export interface AttendanceListResponse {
  class: string;
  section: string;
  date: string | null;
  summary: AttendanceSummary;
  records: AttendanceRecord[];
}

export interface AuditEntry {
  id: number;
  attendance_id: number | null;
  student_id: number;
  action: string;
  old_status: string | null;
  new_status: string | null;
  actor: string;
  created_at: string;
}

export interface AuditListResponse {
  total: number;
  entries: AuditEntry[];
}
