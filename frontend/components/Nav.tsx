"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  API_BASE,
  ApiKeys,
  getKeySnapshot,
  getServerKeySnapshot,
  parseKeys,
  subscribeKeyListeners,
  writeStoredKeys,
} from "@/lib/api";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/students", label: "Students" },
  { href: "/recognition", label: "Recognize" },
  { href: "/attendance", label: "Attendance" },
] as const;

/**
 * Top navigation + API-key drawer.
 *
 * The backend expects two keys (`X-API-Key`): a teacher key for reads,
 * recognition and attendance, and an admin key for student/face management.
 * Keys live only in this browser's localStorage - never in code or git.
 */
export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // localStorage lives outside React, so subscribe to it instead of copying it
  // into state during an effect (see https://react.dev/you-might-not-need-an-effect).
  const keysRaw = useSyncExternalStore(
    subscribeKeyListeners,
    getKeySnapshot,
    getServerKeySnapshot,
  );
  const keys = useMemo(() => parseKeys(keysRaw), [keysRaw]);

  const persist = useCallback((next: ApiKeys) => {
    writeStoredKeys(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-[10px] font-bold text-white">
            AI
          </span>
          Attendance
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="ml-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            API keys
            <span
              className={`ml-2 inline-block h-1.5 w-1.5 rounded-full ${
                keys.admin || keys.teacher ? "bg-emerald-500" : "bg-slate-300"
              }`}
            />
          </button>
        </nav>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5 sm:grid-cols-2 sm:px-6">
            <div className="sm:col-span-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-500">
              <span>
                API base URL: <code className="rounded bg-slate-200 px-1.5 py-0.5">{API_BASE}</code>
              </span>
              <span>Override with <code className="rounded bg-slate-200 px-1.5 py-0.5">NEXT_PUBLIC_API_URL</code></span>
            </div>

            <KeyField
              label="Teacher key"
              hint="Reads, recognition, attendance processing and manual corrections."
              value={keys.teacher}
              onChange={(value) => persist({ ...keys, teacher: value })}
            />
            <KeyField
              label="Admin key"
              hint="Student CRUD and face-photo uploads (biometric management)."
              value={keys.admin}
              onChange={(value) => persist({ ...keys, admin: value })}
            />

            <div className="sm:col-span-2 flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Leave both blank if the backend runs with auth disabled (no keys configured).
              </p>
              {saved && <span className="text-xs font-medium text-emerald-600">Saved.</span>}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function KeyField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-800">{label}</span>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="X-API-Key value"
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
      />
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  );
}