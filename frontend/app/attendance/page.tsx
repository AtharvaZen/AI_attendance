"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import type {
  AttendanceListResponse,
  AttendanceProcessResponse,
  AttendanceRecord,
  AttendanceStatus,
  AuditListResponse,
  ClassSummary,
} from "@/lib/types";
import {
  Card,
  ErrorBanner,
  fieldClass,
  primaryButtonClass,
  EmptyState,
  Spinner,
  Stat,
  StatusBadge,
  StatusSelect,
  SuccessBanner,
} from "@/components/ui";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Date has no external source to watch - uSES just needs a stable no-op. */
const subscribeToday = () => () => {};
/** Server must render an empty date; see the note where it is consumed. */
const serverToday = () => "";

export default function AttendancePage() {
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("");
  // Date must not be computed during the server render: `todayISO()` would
  // freeze the server's day into prerendered HTML (e.g. the build day), which
  // can never match the client on any later day - hydration mismatch on
  // /attendance. uSES renders "" on both sides at hydration, then the client
  // snapshot supplies today's date (the `!processDate` guard in `run` covers
  // the first tick).
  const today = useSyncExternalStore(subscribeToday, todayISO, serverToday);
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const processDate = pickedDate ?? today;
  const [filterDate, setFilterDate] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<AttendanceProcessResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const [data, setData] = useState<AttendanceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<number | null>(null);
  const [audit, setAudit] = useState<AuditListResponse | null>(null);
  const [classes, setClasses] = useState<ClassSummary[]>([]);

  /** Pure fetch - no state writes, so it is safe to call from an effect. */
  const fetchRegister = useCallback(async (): Promise<AttendanceListResponse | null> => {
    // GET /api/attendance requires both class_name and section; there is
    // nothing to query until they are known (the empty state below covers it).
    if (!className || !section) return null;
    const params = new URLSearchParams({ class_name: className, section });
    if (filterDate) params.set("attendance_date", filterDate);
    return api.get<AttendanceListResponse>(`/api/attendance?${params.toString()}`, "teacher");
  }, [className, section, filterDate]);

  /** Writes a fetch result. Only ever called from callbacks or handlers. */
  const applyRegister = useCallback((result: AttendanceListResponse | null) => {
    setData(result);
    setError(null);
  }, []);

  /** Explicit refresh (event handlers and post-mutation reloads). */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      applyRegister(await fetchRegister());
    } catch (err) {
      setError(err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [applyRegister, fetchRegister]);

  // Effects only write state from within a callback (react.dev guidance).
  useEffect(() => {
    let cancelled = false;
    fetchRegister()
      .then(
        (result) => {
          if (!cancelled) applyRegister(result);
        },
        (err: unknown) => {
          if (!cancelled) {
            setError(err);
            setData(null);
          }
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchRegister, applyRegister]);

  // Discover known classes once so the view has valid filters straight away.
  useEffect(() => {
    api
      .get<{ classes: ClassSummary[] }>("/api/students/classes", "teacher")
      .then((list) => {
        setClasses(list.classes);
        const first = list.classes[0];
        if (first) {
          setClassName(first.class_name);
          setSection(first.section);
        } else {
          setLoading(false);
        }
      })
      .catch((err: unknown) => setError(err));
  }, []);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 5000);
  };

  const pickFile = (chosen: File | null) => {
    setFile(chosen);
    setProcessResult(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(chosen ? URL.createObjectURL(chosen) : null);
  };

  const run = async () => {
    if (!file || !className || !section || !processDate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.upload<AttendanceProcessResponse>(
        "/api/attendance/process",
        file,
        { class_name: className, section, attendance_date: processDate },
        "teacher",
      );
      setProcessResult(result);
      flash(
        `Marked ${result.recognized_students} student(s) for class ${result.class} ${result.section} on ${result.date}.`,
      );
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const correct = async (record: AttendanceRecord, status: AttendanceStatus) => {
    setError(null);
    try {
      await api.patch<AttendanceRecord>(`/api/attendance/${record.id}`, { status }, "teacher");
      flash(`${record.name}: ${record.status} → ${status} (audited).`);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const showAudit = async (record: AttendanceRecord) => {
    if (auditId === record.id) {
      setAuditId(null);
      setAudit(null);
      return;
    }
    setError(null);
    try {
      setAudit(
        await api.get<AuditListResponse>(`/api/attendance/${record.id}/audit`, "teacher"),
      );
      setAuditId(record.id);
    } catch (err) {
      setError(err);
    }
  };

  const classNames = [...new Set(classes.map((entry) => entry.class_name))];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Attendance</h1>
        <p className="mt-1 text-sm text-slate-500">
          Process a classroom photo to mark the register, then correct any row by hand — every
          correction is written to the audit trail.
        </p>
      </div>

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Mark attendance"
          subtitle="POST /api/attendance/process — idempotent per class and date."
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Class</span>
                <input
                  required
                  value={className}
                  onChange={(event) => setClassName(event.target.value)}
                  placeholder="8"
                  className={fieldClass}
                  list="known-classes"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Section</span>
                <input
                  required
                  value={section}
                  onChange={(event) => setSection(event.target.value)}
                  placeholder="A"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Date</span>
                <input
                  type="date"
                  required
                  value={processDate}
                  onChange={(event) => setPickedDate(event.target.value)}
                  className={fieldClass}
                />
              </label>
              <datalist id="known-classes">
                {classes.map((entry) => (
                  <option key={`${entry.class_name}-${entry.section}`} value={entry.class_name} />
                ))}
              </datalist>
            </div>

            <div className="flex items-center gap-3">
              <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {file ? "Change photo" : "Choose photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                onClick={() => void run()}
                disabled={!file || busy || !className || !section}
                className={primaryButtonClass}
              >
                {busy ? "Processing…" : "Process photo"}
              </button>
              {file && <span className="truncate text-xs text-slate-500">{file.name}</span>}
            </div>

            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Selected classroom"
                className="max-h-56 rounded-lg border border-slate-200 bg-slate-900 object-contain"
              />
            )}
          </div>
        </Card>

        <Card
          title="Last processing run"
          subtitle={
            processResult
              ? `Class ${processResult.class} ${processResult.section} · ${processResult.date}`
              : "Result of the most recent photo"
          }
        >
          {!processResult && !busy && (
            <p className="py-8 text-center text-sm text-slate-500">
              No photo processed in this session yet.
            </p>
          )}
          {busy && <Spinner label="Detecting, matching and writing rows" />}
          {processResult && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Faces" value={processResult.total_faces} />
              <Stat label="Recognised" value={processResult.recognized_students} />
              <Stat label="Unknown" value={processResult.unknown_faces} />
              <Stat label="Duplicates" value={processResult.duplicates_removed} />
              <Stat
                label="Already present"
                value={processResult.already_present}
                hint="existing rows kept"
              />
              <Stat label="Out of class" value={processResult.skipped_out_of_class} />
              <Stat
                label="Threshold"
                value={processResult.threshold.toFixed(2)}
                hint="cosine similarity"
              />
              <Stat label="Time" value={`${(processResult.processing_time_ms / 1000).toFixed(2)}s`} />
              <Stat label="Written" value={processResult.attendance.length} hint="rows this run" />
            </dl>
          )}
        </Card>
      </div>

      <Card
        title="Register"
        subtitle="GET /api/attendance — click Audit to inspect an individual row's history."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Class"
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              className={fieldClass + " w-auto py-1 text-xs"}
            >
              {classNames.length === 0 && <option value="">(no classes)</option>}
              {classNames.map((name) => (
                <option key={name} value={name}>
                  Class {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Section"
              value={section}
              onChange={(event) => setSection(event.target.value)}
              className={fieldClass + " w-auto py-1 text-xs"}
            >
              {classes
                .filter((entry) => !className || entry.class_name === className)
                .map((entry) => (
                  <option key={`${entry.class_name}-${entry.section}`} value={entry.section}>
                    {entry.section}
                  </option>
                ))}
            </select>
            <input
              type="date"
              aria-label="Filter by date"
              value={filterDate}
              onChange={(event) => setFilterDate(event.target.value)}
              className={fieldClass + " w-auto py-1 text-xs"}
            />
            {filterDate && (
              <button
                type="button"
                onClick={() => setFilterDate("")}
                className="text-xs font-medium text-slate-500 underline"
              >
                all dates
              </button>
            )}
          </div>
        }
      >
        {loading ? (
          <Spinner label="Loading attendance" />
        ) : !data ? (
          <EmptyState>Select a class and section to load the register.</EmptyState>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 text-sm">
              <SummaryPill label="total" value={data.summary.total} tone="text-slate-700" />
              <SummaryPill label="present" value={data.summary.present} tone="text-emerald-700" />
              <SummaryPill label="absent" value={data.summary.absent} tone="text-red-700" />
              <SummaryPill label="late" value={data.summary.late} tone="text-amber-700" />
              <SummaryPill label="excused" value={data.summary.excused} tone="text-sky-700" />
            </div>

            {data.records.length === 0 ? (
              <EmptyState>
                Nothing recorded for class {data.class} {data.section}
                {data.date ? ` on ${data.date}` : ""} yet. Process a classroom photo above.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-4 font-medium">Roll</th>
                      <th className="py-2 pr-4 font-medium">Name</th>
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Confidence</th>
                      <th className="py-2 font-medium"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((record) => (
                      <RecordRow
                        key={record.id}
                        record={record}
                        auditOpen={auditId === record.id}
                        audit={auditId === record.id ? audit : null}
                        onCorrect={(status) => void correct(record, status)}
                        onAudit={() => void showAudit(record)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
      <span className={`${tone} font-semibold tabular-nums`}>{value}</span>{" "}
      <span className="text-slate-500">{label}</span>
    </span>
  );
}

function RecordRow({
  record,
  auditOpen,
  audit,
  onCorrect,
  onAudit,
}: {
  record: AttendanceRecord;
  auditOpen: boolean;
  audit: AuditListResponse | null;
  onCorrect: (status: AttendanceStatus) => void;
  onAudit: () => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50">
        <td className="py-2.5 pr-4 font-mono text-slate-700">{record.roll_number}</td>
        <td className="py-2.5 pr-4 font-medium text-slate-900">{record.name}</td>
        <td className="py-2.5 pr-4 text-slate-500">{record.date}</td>
        <td className="py-2.5 pr-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={record.status} />
            <StatusSelect
              value={record.status}
              onChange={onCorrect}
              aria-label={`Status for ${record.name}`}
            />
          </div>
        </td>
        <td
          className="py-2.5 pr-4 font-mono text-xs text-slate-600"
          title={
            record.confidence === null
              ? "Manually created row — no model match."
              : "Cosine similarity of the match, not a probability of identity."
          }
        >
          {record.confidence === null ? "manual" : record.confidence.toFixed(3)}
        </td>
        <td className="py-2.5 text-right">
          <button
            type="button"
            onClick={onAudit}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-white"
          >
            {auditOpen ? "Hide audit" : "Audit"}
          </button>
        </td>
      </tr>
      {auditOpen && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={6} className="px-3 py-3">
            {!audit ? (
              <Spinner label="Loading audit trail" />
            ) : audit.entries.length === 0 ? (
              <p className="text-xs text-slate-500">No audit entries for this row.</p>
            ) : (
              <ul className="space-y-1.5">
                {audit.entries.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium text-slate-700">
                      {entry.action}
                    </span>
                    {entry.old_status && entry.new_status && (
                      <span className="text-slate-600">
                        {entry.old_status} → <b>{entry.new_status}</b>
                      </span>
                    )}
                    <span className="text-slate-500">by {entry.actor}</span>
                    <span className="text-slate-400">
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}


