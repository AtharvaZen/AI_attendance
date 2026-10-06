"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { HealthResponse } from "@/lib/types";
import { Card, Dot, ErrorBanner, Spinner, Stat } from "@/components/ui";

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  // Explicit refresh - only ever called from event handlers.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHealth(await api.health());
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Effects should only write state from a callback (react.dev: you might not
  // need an effect), so the promise is resolved in `.then` handlers.
  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then(
        (data) => {
          if (!cancelled) {
            setHealth(data);
            setError(null);
          }
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
  }, []);

  const modelReady = health?.model_loaded && health.status === "ok";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live status of the attendance API and the face-recognition model.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <ErrorBanner error={error} />

      {loading && !health ? <Spinner label="Reading /health" /> : null}

      {health && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Model"
              value={
                <span className="flex items-center gap-2 text-xl">
                  <Dot ok={modelReady} warn={!modelReady && health.status === "starting"} />
                  {health.status}
                </span>
              }
              hint={health.model}
            />
            <Stat
              label="Match threshold"
              value={health.match_threshold.toFixed(2)}
              hint="cosine similarity"
            />
            <Stat
              label="Students"
              value={health.students}
              hint={`${health.face_embeddings} face embeddings`}
            />
            <Stat
              label="Storage"
              value={health.storage_backend}
              hint={health.database_connected ? "database connected" : health.database_info}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Service" subtitle="Metadata returned by GET /health">
              <dl className="divide-y divide-slate-100 text-sm">
                <Row label="Environment" value={health.environment} />
                <Row label="Providers" value={health.providers.join(", ") || "—"} />
                <Row
                  label="Auth"
                  value={health.auth_enabled ? "enabled (X-API-Key required)" : "disabled"}
                />
                <Row label="Database" value={health.database_info} />
                <Row
                  label="Face model loaded"
                  value={health.model_loaded ? "yes" : "no — waiting for startup"}
                />
              </dl>
            </Card>

            <Card title="Quick actions" subtitle="Common workflows">
              <ul className="space-y-3 text-sm">
                <Action
                  href="/students"
                  title="Register students"
                  body="Create a student and upload 3–10 face photos for embedding."
                />
                <Action
                  href="/recognition"
                  title="Test recognition"
                  body="Upload a classroom photo and inspect matches — nothing is written."
                />
                <Action
                  href="/attendance"
                  title="Mark attendance"
                  body="Process a photo for a class/date, then correct statuses manually."
                />
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-800" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Action({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-lg border border-slate-200 px-3 py-2.5 transition hover:border-slate-300 hover:bg-slate-50"
      >
        <span className="font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{body}</span>
      </Link>
    </li>
  );
}
