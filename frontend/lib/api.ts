import type { HealthResponse } from "./types";

/**
 * Thin API client for the attendance backend.
 *
 * Everything the backend can return is funnelled through `request()` so that:
 *  - the `X-API-Key` header is attached for both the admin and teacher roles;
 *  - the uniform `{"detail": ..., "code": ...}` error envelope becomes an
 *    `ApiError` with a readable message;
 *  - network/parse failures surface as a code instead of an unhandled throw.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type ApiRole = "admin" | "teacher";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Raw `detail` - a string for most errors, an array for 422s. */
    readonly detail: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const KEYS_STORAGE = "attendance.apiKeys";
/** Session issued by POST /api/auth/login. */
const SESSION_STORAGE = "attendance.session";

export type ApiKeys = Record<ApiRole, string>;

export interface Session {
  token: string;
  role: "admin" | "teacher";
  username: string;
  expiresAt: string;
}

/**
 * Local subscription hub for the stored keys. `localStorage` writes do not fire
 * the browser's `storage` event in the same tab, so we fan out ourselves and
 * merge in the native event for other tabs.
 */
const keyListeners = new Set<() => void>();

function notifyKeyListeners(): void {
  for (const listener of keyListeners) listener();
}

export function subscribeKeyListeners(listener: () => void): () => void {
  keyListeners.add(listener);
  return () => {
    keyListeners.delete(listener);
  };
}

/**
 * Snapshot of the raw stored value. Returns a string so `useSyncExternalStore`
 * sees a referentially stable value and never loops.
 */
export function getKeySnapshot(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEYS_STORAGE) ?? "";
  } catch {
    return "";
  }
}

/** Server snapshot - localStorage does not exist during prerender. */
export function getServerKeySnapshot(): string {
  return "";
}

export function parseKeys(raw: string): ApiKeys {
  if (!raw) return { admin: "", teacher: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    return { admin: parsed.admin ?? "", teacher: parsed.teacher ?? "" };
  } catch {
    return { admin: "", teacher: "" };
  }
}

export function readStoredKeys(): ApiKeys {
  // An explicit override (set by useKeys, e.g. the Node smoke test) wins over
  // localStorage, which does not exist outside the browser.
  if (keyOverride) return keyOverride;
  return parseKeys(getKeySnapshot());
}

/** In-memory key store used when localStorage is unavailable. */
let keyOverride: ApiKeys | null = null;

export function writeStoredKeys(keys: ApiKeys): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    /* private mode / quota - ignore */
  }
  notifyKeyListeners();
}

/* -------------------------------------------------------------- session --- */

/**
 * Session issued by /api/auth/login. A signed token takes precedence over the
 * legacy per-role API keys, so a logged-in user is always sent their token.
 */
let session: Session | null = null;

function readSession(): Session | null {
  if (session) return session;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(value: Session | null): void {
  session = value;
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(SESSION_STORAGE, JSON.stringify(value));
    else window.localStorage.removeItem(SESSION_STORAGE);
  } catch {
    /* ignore */
  }
  notifyKeyListeners();
}

export function currentSession(): Session | null {
  return readSession();
}

export function startSession(value: Session): void {
  writeSession(value);
}

export function endSession(): void {
  writeSession(null);
}

/**
 * Seed the key store directly. Used by the Node smoke test, where `localStorage`
 * does not exist; the browser goes through `startSession` / `writeStoredKeys`.
 */
export function useKeys(keys: ApiKeys, activeSession: Session | null = null): void {
  keyOverride = keys;
  writeStoredKeys(keys);
  writeSession(activeSession);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", notifyKeyListeners);
}

/** Flatten FastAPI's 422 `detail` array into one readable sentence. */
function messageFromDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((issue) => {
        const entry = issue as { loc?: unknown[]; msg?: string };
        const where = (entry.loc ?? [])
          .slice(1)
          .map(String)
          .join(".");
        return where ? `${where}: ${entry.msg ?? "invalid"}` : entry.msg ?? "invalid";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
    return "Request failed validation.";
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return "Request failed.";
}

interface RequestOptions {
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  /** Which stored key to send. Omit for unauthenticated calls (e.g. /health). */
  role?: ApiRole;
  /** `FormData` sets its own multipart boundary. */
  raw?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  const role = options.role;
  // A signed session token wins over the legacy per-role key, so a signed-in
  // user is never blocked by a stale or empty API key.
  const active = readSession();
  if (active?.token) {
    headers["X-API-Key"] = active.token;
  } else if (role) {
    const key = readStoredKeys()[role];
    if (key) headers["X-API-Key"] = key;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ?? undefined,
    });
  } catch (cause) {
    throw new ApiError(
      0,
      "network_error",
      `Could not reach the API at ${API_BASE}. Is the backend running? (${String(cause)})`,
      null,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = (payload ?? {}) as { detail?: unknown; code?: string };
    const code =
      envelope.code ??
      (response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : "error");
    throw new ApiError(response.status, code, messageFromDetail(envelope.detail), envelope.detail);
  }

  if (payload === null) return undefined as T;
  return payload as T;
}

export const api = {
  base: API_BASE,

  /** Sign in and store the returned session. */
  login: (username: string, password: string) =>
    request<{ token: string; role: "admin" | "teacher"; username: string; expires_at: string }>(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
    ).then((data) => {
      startSession({
        token: data.token,
        role: data.role,
        username: data.username,
        expiresAt: data.expires_at,
      });
      return data;
    }),

  /** Clear the stored session (keys are left untouched). */
  logout: () => endSession(),

  get: <T,>(path: string, role?: ApiRole) => request<T>(path, { role }),

  post: <T,>(path: string, body: unknown, role?: ApiRole) =>
    request<T>(path, {
      method: "POST",
      role,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  patch: <T,>(path: string, body: unknown, role?: ApiRole) =>
    request<T>(path, {
      method: "PATCH",
      role,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  delete: <T,>(path: string, role?: ApiRole) =>
    request<T>(path, { method: "DELETE", role }),

  /** Multipart upload. `fields` become form fields, `file` is the `file` part. */
  upload: <T,>(
    path: string,
    file: File,
    fields: Record<string, string>,
    role?: ApiRole,
  ) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form, role });
  },

  health: () => request<HealthResponse>("/health"),
};
