"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ClassSummary, Student } from "@/lib/types";
import {
  Card,
  ErrorBanner,
  fieldClass,
  primaryButtonClass,
  EmptyState,
  Spinner,
  SuccessBanner,
} from "@/components/ui";
import { FacePanel } from "@/components/FacePanel";

const EMPTY_FILTERS = { class_name: "", section: "" };

type StudentsBundle = {
  list: { total: number; students: Student[] };
  classList: { classes: ClassSummary[] };
};

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  /** Pure fetch - no state writes, so it is safe to call from an effect. */
  const fetchStudents = useCallback(async (): Promise<StudentsBundle> => {
    const params = new URLSearchParams({ limit: "200" });
    if (filters.class_name) params.set("class_name", filters.class_name);
    if (filters.section) params.set("section", filters.section);
    const [list, classList] = await Promise.all([
      api.get<StudentsBundle["list"]>(`/api/students?${params.toString()}`, "teacher"),
      api.get<StudentsBundle["classList"]>("/api/students/classes", "teacher"),
    ]);
    return { list, classList };
  }, [filters.class_name, filters.section]);

  /** Writes a fetch result. Only ever called from callbacks or handlers. */
  const applyStudents = useCallback((result: StudentsBundle) => {
    setStudents(result.list.students);
    setTotal(result.list.total);
    setClasses(result.classList.classes);
    setError(null);
  }, []);

  /** Explicit refresh used by buttons and after mutations. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      applyStudents(await fetchStudents());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [applyStudents, fetchStudents]);

  // Effects only write state from within a callback (react.dev guidance).
  useEffect(() => {
    let cancelled = false;
    fetchStudents()
      .then(
        (result) => {
          if (!cancelled) applyStudents(result);
        },
        (err: unknown) => {
          if (!cancelled) setError(err);
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchStudents, applyStudents]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4000);
  };

  const removeStudent = async (student: Student) => {
    const confirmed = window.confirm(
      `Delete ${student.name} (${student.roll_number}) and all ${student.face_count} stored face embeddings? This cannot be undone.`,
    );
    if (!confirmed) return;
    setError(null);
    try {
      await api.delete(`/api/students/${student.id}`, "admin");
      flash(`Deleted ${student.name}.`);
      setExpanded(null);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const classNames = [...new Set(classes.map((entry) => entry.class_name))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Students</h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} registered · each student needs 3–10 face photos before recognition works
            reliably.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Filter by class"
            value={filters.class_name}
            onChange={(event) =>
              setFilters({ class_name: event.target.value, section: "" })
            }
            className={fieldClass + " w-auto"}
          >
            <option value="">All classes</option>
            {classNames.map((name) => (
              <option key={name} value={name}>
                Class {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by section"
            value={filters.section}
            onChange={(event) => setFilters({ ...filters, section: event.target.value })}
            className={fieldClass + " w-auto"}
          >
            <option value="">All sections</option>
            {classes
              .filter((entry) => !filters.class_name || entry.class_name === filters.class_name)
              .map((entry) => (
                <option key={`${entry.class_name}-${entry.section}`} value={entry.section}>
                  Section {entry.section}
                </option>
              ))}
          </select>
          <button type="button" onClick={() => setCreating((v) => !v)} className={primaryButtonClass}>
            {creating ? "Close" : "New student"}
          </button>
        </div>
      </div>

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      {creating && (
        <CreateStudentForm
          onCreated={(message) => {
            setCreating(false);
            flash(message);
            void load();
          }}
          onError={setError}
        />
      )}

      <Card
        title="Registry"
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
        }
      >
        {loading ? (
          <Spinner label="Loading students" />
        ) : students.length === 0 ? (
          <EmptyState>No students match these filters. Create one to get started.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Roll</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Class</th>
                  <th className="py-2 pr-4 font-medium">Faces</th>
                  <th className="py-2 pr-4 font-medium">Registered</th>
                  <th className="py-2 font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <StudentRow
                    key={student.id}
                    student={student}
                    expanded={expanded === student.id}
                    onToggle={() =>
                      setExpanded((current) => (current === student.id ? null : student.id))
                    }
                    onDelete={() => void removeStudent(student)}
                    onChanged={() => void load()}
                    onError={setError}
                    onNotice={flash}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StudentRow({
  student,
  expanded,
  onToggle,
  onDelete,
  onChanged,
  onError,
  onNotice,
}: {
  student: Student;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onChanged: () => void;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
}) {
  const ready = student.face_count >= 3;
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50">
        <td className="py-2.5 pr-4 font-mono text-slate-700">{student.roll_number}</td>
        <td className="py-2.5 pr-4 font-medium text-slate-900">{student.name}</td>
        <td className="py-2.5 pr-4 text-slate-600">
          {student.class_name} · {student.section}
        </td>
        <td className="py-2.5 pr-4">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
              ready
                ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                : "bg-amber-100 text-amber-800 ring-amber-200"
            }`}
            title={ready ? "Enough photos for reliable matching" : "Upload at least 3 photos"}
          >
            {student.face_count} {ready ? "ready" : "need more"}
          </span>
        </td>
        <td className="py-2.5 pr-4 text-slate-500">
          {new Date(student.created_at).toLocaleDateString()}
        </td>
        <td className="py-2.5 text-right whitespace-nowrap">
          <button
            type="button"
            onClick={onToggle}
            className="mr-2 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white"
          >
            {expanded ? "Hide faces" : "Faces"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100">
          <td colSpan={6} className="bg-slate-50 px-3 py-4">
            <FacePanel
              student={student}
              onChanged={onChanged}
              onError={onError}
              onNotice={onNotice}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function CreateStudentForm({
  onCreated,
  onError,
}: {
  onCreated: (message: string) => void;
  onError: (error: unknown) => void;
}) {
  const [form, setForm] = useState({
    roll_number: "",
    name: "",
    class_name: "",
    section: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    onError(null);
    try {
      const created = await api.post<Student>("/api/students", form, "admin");
      setForm({ roll_number: "", name: "", class_name: "", section: "" });
      onCreated(`Registered ${created.name} (roll ${created.roll_number}).`);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Register a student"
      subtitle="Administrative details only — face photos are uploaded from the row below."
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Roll number</span>
          <input
            required
            value={form.roll_number}
            onChange={(event) => setForm({ ...form, roll_number: event.target.value })}
            placeholder="101"
            className={fieldClass}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-slate-600">Full name</span>
          <input
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Rahul Sharma"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Class</span>
          <input
            required
            value={form.class_name}
            onChange={(event) => setForm({ ...form, class_name: event.target.value })}
            placeholder="8"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Section</span>
          <input
            required
            value={form.section}
            onChange={(event) => setForm({ ...form, section: event.target.value })}
            placeholder="A"
            className={fieldClass}
          />
        </label>
        <div className="flex items-end sm:col-span-4">
          <button type="submit" disabled={saving} className={primaryButtonClass}>
            {saving ? "Saving…" : "Create student"}
          </button>
        </div>
      </form>
    </Card>
  );
}

