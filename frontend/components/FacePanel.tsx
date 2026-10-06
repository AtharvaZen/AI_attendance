"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { FaceMetadata, FaceUploadResponse, Student, StudentFacesResponse } from "@/lib/types";
import { dangerButtonClass, ErrorBanner, Spinner } from "@/components/ui";

/**
 * Per-student biometric management: list stored embeddings (metadata only —
 * the vectors are never returned by the API), upload new photos, delete one
 * or clear them all. Every mutating call uses the admin key.
 */
export function FacePanel({
  student,
  onChanged,
  onError,
  onNotice,
}: {
  student: Student;
  onChanged: () => void;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
}) {
  const [faces, setFaces] = useState<FaceMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<unknown>(null);

  /** Pure fetch - no state writes, so it is safe to call from an effect. */
  const fetchFaces = useCallback(async (): Promise<FaceMetadata[]> => {
    const data = await api.get<StudentFacesResponse>(
      `/api/students/${student.id}/faces`,
      "teacher",
    );
    return data.faces;
  }, [student.id]);

  /** Explicit refresh - only ever called from event handlers. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFaces(await fetchFaces());
      setLocalError(null);
    } catch (err) {
      setLocalError(err);
    } finally {
      setLoading(false);
    }
  }, [fetchFaces]);

  // Effects only write state from within a callback (react.dev guidance).
  useEffect(() => {
    let cancelled = false;
    fetchFaces()
      .then(
        (list) => {
          if (!cancelled) {
            setFaces(list);
            setLocalError(null);
          }
        },
        (err: unknown) => {
          if (!cancelled) setLocalError(err);
        },
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchFaces]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setLocalError(null);
    const results: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const result = await api.upload<FaceUploadResponse>(
          `/api/students/${student.id}/faces`,
          file,
          {},
          "admin",
        );
        results.push(
          `${file.name}: det ${result.det_score.toFixed(3)} · ${result.total_faces} stored`,
        );
        if (!result.is_ready) {
          results.push("needs more photos (3–10 recommended)");
        }
      }
      onNotice(`${student.name} — ${results.join(" · ")}`);
      await load();
      onChanged();
    } catch (err) {
      setLocalError(err);
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const removeFace = async (face: FaceMetadata) => {
    setBusy(true);
    setLocalError(null);
    try {
      const result = await api.delete<{ message: string }>(
        `/api/students/${student.id}/faces/${face.id}`,
        "admin",
      );
      onNotice(result.message);
      await load();
      onChanged();
    } catch (err) {
      setLocalError(err);
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (
      !window.confirm(
        `Remove ALL ${faces.length} stored face embeddings for ${student.name}? Recognition will stop working for them until re-uploaded.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const result = await api.delete<{ message: string }>(
        `/api/students/${student.id}/faces`,
        "admin",
      );
      onNotice(result.message);
      await load();
      onChanged();
    } catch (err) {
      setLocalError(err);
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Face photos — {student.name}
            <span className="ml-2 font-mono text-xs font-normal text-slate-500">
              #{student.id}
            </span>
          </h3>
          <p className="text-xs text-slate-500">
            Upload 3–10 clear, varied photos (different angles and lighting). Photos derived from a
            single source image are accepted but match less reliably.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label
            className={`cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ${
              busy ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {busy ? "Working…" : "Upload photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          {faces.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              disabled={busy}
              className={dangerButtonClass}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={localError} />

      {loading ? (
        <Spinner label="Loading face metadata" />
      ) : faces.length === 0 ? (
        <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-xs text-amber-800">
          No face embeddings stored yet. This student cannot be recognised until at least 3 photos
          are uploaded.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {faces.map((face, index) => (
            <li key={face.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {index + 1}
                </span>
                <span className="font-mono text-xs text-slate-500">face #{face.id}</span>
                <span
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                  title="Detection confidence of the photo — NOT an identity probability."
                >
                  det {face.det_score.toFixed(3)}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(face.created_at).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void removeFace(face)}
                disabled={busy}
                className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
