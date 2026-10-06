"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { RecognitionResponse } from "@/lib/types";
import { Card, ErrorBanner, Spinner, Stat, primaryButtonClass } from "@/components/ui";

export default function RecognitionPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [result, setResult] = useState<RecognitionResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (chosen: File | null) => {
    setFile(chosen);
    setResult(null);
    setError(null);
    setNatural(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(chosen ? URL.createObjectURL(chosen) : null);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.upload<RecognitionResponse>(
          "/api/recognition/recognize",
          file,
          {},
          "teacher",
        ),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Recognize</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dry run — detects and matches faces against enrolled students but writes nothing to the
          database. Use <b>Attendance</b> when you want to mark a class.
        </p>
      </div>

      <ErrorBanner error={error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Classroom photo"
          subtitle="JPEG or PNG. One photo per request."
          action={
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Choose…
            </button>
          }
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => pick(event.target.files?.[0] ?? null)}
          />

          {!preview ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-12 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50"
            >
              <span className="text-2xl">📷</span>
              Select a classroom photo
            </button>
          ) : (
            <div className="relative overflow-hidden rounded-lg bg-slate-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Selected classroom"
                className="max-h-[420px] w-full object-contain"
                onLoad={(event) =>
                  setNatural({
                    w: event.currentTarget.naturalWidth,
                    h: event.currentTarget.naturalHeight,
                  })
                }
              />
              {result &&
                natural &&
                result.recognized.map((match, index) => {
                  const [x1, y1, x2, y2] = match.face_bbox;
                  return (
                    <div
                      key={`${match.student_id}-${index}-${x1}-${y1}`}
                      className="absolute border-2 border-emerald-400"
                      style={{
                        left: `${(x1 / natural.w) * 100}%`,
                        top: `${(y1 / natural.h) * 100}%`,
                        width: `${((x2 - x1) / natural.w) * 100}%`,
                        height: `${((y2 - y1) / natural.h) * 100}%`,
                      }}
                    >
                      <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-emerald-500 px-1 py-0.5 text-[10px] font-semibold text-white">
                        {match.roll_number} {match.confidence.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}

          <p className="mt-3 text-xs text-slate-400">
            Boxes are drawn for <b>matched</b> faces only — the API returns bounding boxes for
            recognised students; unrecognised faces are reported as a count.
          </p>
        </Card>

        <Card
          title="Results"
          subtitle={result ? "POST /api/recognition/recognize" : "Awaiting a photo"}
        >
          {!result && !busy && (
            <p className="py-8 text-center text-sm text-slate-500">No recognition run yet.</p>
          )}
          {busy && <Spinner label="Detecting and matching faces" />}
          {result && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Faces found" value={result.total_faces} />
                <Stat label="Matched" value={result.recognized.length} />
                <Stat label="Unknown" value={result.unknown_faces} />
                <Stat label="Duplicates" value={result.duplicates_removed} hint="extra appearances" />
                <Stat label="Threshold" value={result.threshold.toFixed(2)} hint="cosine similarity" />
                <Stat
                  label="Margin"
                  value={`≥ ${(result.margin_threshold ?? 0).toFixed(2)}`}
                  hint="lead over best rival"
                />
                <Stat label="Time" value={`${(result.processing_time_ms / 1000).toFixed(2)}s`} />
              </dl>

              <ul className="max-h-72 space-y-2 overflow-y-auto thin-scroll">
                {result.recognized.length === 0 && (
                  <li className="text-sm text-slate-500">No students matched.</li>
                )}
                {result.recognized.map((match, index) => {
                  const detail = (result.match_details ?? []).find(
                    (d) =>
                      d.decision === "match" &&
                      d.student_id === match.student_id &&
                      d.bbox[0] === match.face_bbox[0] &&
                      d.bbox[1] === match.face_bbox[1]
                  );
                  return (
                    <li
                      key={`${match.student_id}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {match.name}
                          <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                            {match.roll_number}
                          </span>
                        </p>
                        <p className="text-xs text-slate-500">
                          class {match.class_name} · {match.section}
                          {detail?.margin != null && (
                            <span className="ml-2">
                              margin {detail.margin.toFixed(3)}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-semibold text-slate-800">
                          {match.confidence.toFixed(3)}
                        </p>
                        <div className="ml-auto h-1 w-20 overflow-hidden rounded bg-slate-100">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${Math.min(100, match.confidence * 100)}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {preview && (
        <button type="button" onClick={() => void run()} disabled={busy} className={primaryButtonClass}>
          {busy ? "Running…" : result ? "Run again" : "Run recognition"}
        </button>
      )}
    </div>
  );
}
