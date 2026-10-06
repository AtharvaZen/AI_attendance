"use client";

import type { ReactNode } from "react";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/types";
import { ApiError } from "@/lib/api";

/* ------------------------------ error handling ----------------------------- */

export function errorOf(err: unknown): ApiError | Error {
  return err instanceof ApiError ? err : new Error(String(err));
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = errorOf(error);
  const status = e instanceof ApiError ? e.status : 0;
  const code = e instanceof ApiError ? e.code : "error";
  const tone =
    status === 401 || status === 403
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-red-300 bg-red-50 text-red-900";
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${tone}`} role="alert">
      <span className="mr-2 inline-block rounded bg-black/10 px-1.5 py-0.5 font-mono text-xs">
        {code}
        {status ? ` ${status}` : ""}
      </span>
      {e.message}
      {status === 401 || status === 403 ? (
        <span className="mt-1 block text-amber-800">
          Open <b>API keys</b> in the header and save a key for this role.
        </span>
      ) : null}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      {message}
    </div>
  );
}

/* --------------------------------- layout ---------------------------------- */

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      {label}…
    </div>
  );
}

/* --------------------------------- badges ---------------------------------- */

const STATUS_STYLE: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  absent: "bg-red-100 text-red-800 ring-red-200",
  late: "bg-amber-100 text-amber-800 ring-amber-200",
  excused: "bg-sky-100 text-sky-800 ring-sky-200",
};

export function StatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_STYLE[status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {status}
    </span>
  );
}

export function Dot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  const color = ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

/* -------------------------------- controls --------------------------------- */

export function StatusSelect({
  value,
  onChange,
  disabled,
  className = "",
  ...rest
}: {
  value: string;
  onChange: (next: AttendanceStatus) => void;
  disabled?: boolean;
  className?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as AttendanceStatus)}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 ${className}`}
      {...rest}
    >
      {ATTENDANCE_STATUSES.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}

export const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export const dangerButtonClass =
  "inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";
