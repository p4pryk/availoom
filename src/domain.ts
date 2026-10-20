export type Provider = "Codex" | "Claude" | "Gemini" | "Grok";
export const providers: Provider[] = ["Codex", "Claude", "Gemini", "Grok"];
export interface QuotaSnapshot {
  schemaVersion: 1;
  provider: Provider;
  product: string;
  accountRef: string | null;
  planLabel: string | null;
  poolId: string;
  poolLabel?: string;
  modelScope: string | null;
  windowKind: "unknown" | "fixed" | "rolling";
  windowDuration: number | null;
  used: number | null;
  remaining: number | null;
  limit: number | null;
  unit: "percent" | null;
  resetsAt: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  sourceKind: "codex_app_server";
  accuracy: "source_reported" | "unknown";
  freshness: "fresh" | "stale" | "unknown";
  capabilityStatus: "experimental" | "unavailable";
}
export interface Reading {
  accountRef: string;
  accountLabel: string;
  planLabel: string | null;
  fetchedAt: number;
  sourceKind: "codex_app_server";
  quotas: {
    poolId: string;
    poolLabel: string;
    used: number | null;
    remaining: number | null;
    windowDuration: number | null;
    resetsAt: number | null;
  }[];
}
export function remainingPercent(used: unknown): number | null {
  return typeof used === "number" &&
    Number.isFinite(used) &&
    used >= 0 &&
    used <= 100
    ? 100 - used
    : null;
}
export function freshness(
  snapshot: QuotaSnapshot,
  now: number,
): QuotaSnapshot["freshness"] {
  if (!snapshot.fetchedAt) return "unknown";
  const fetched = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetched) || fetched > now + 60_000) return "unknown";
  if (snapshot.resetsAt && Date.parse(snapshot.resetsAt) <= now) return "stale";
  return now - fetched > 20 * 60_000 ? "stale" : "fresh";
}
export function durationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0)
    return "Unknown window";
  if (seconds === 604800) return "Week";
  if (seconds % 86400 === 0) return `${seconds / 86400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${Math.round(seconds / 60)} min`;
}
export function percentLabel(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
        value,
      );
}
export function resetLabel(reset: string | null, now: number): string {
  if (!reset || !Number.isFinite(Date.parse(reset)))
    return "Reset time unknown";
  const minutes = Math.ceil((Date.parse(reset) - now) / 60_000);
  if (minutes <= 0) return "Awaiting reset confirmation";
  if (minutes < 60) return `In ${minutes} min`;
  if (minutes < 1440)
    return `In ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return new Date(reset).toLocaleString("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function absoluteTime(date: string | null): string {
  return date
    ? new Date(date).toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No reading";
}
export function toSnapshots(reading: Reading): QuotaSnapshot[] {
  return reading.quotas.map((q) => ({
    schemaVersion: 1,
    provider: "Codex",
    product: "codex_chatgpt",
    accountRef: reading.accountRef,
    planLabel: reading.planLabel,
    poolId: q.poolId,
    poolLabel: q.poolLabel,
    modelScope: null,
    windowKind: "unknown",
    windowDuration: q.windowDuration,
    used: q.used,
    remaining: remainingPercent(q.used),
    limit: q.used === null ? null : 100,
    unit: "percent",
    resetsAt:
      q.resetsAt === null ? null : new Date(q.resetsAt * 1000).toISOString(),
    observedAt: null,
    fetchedAt: new Date(reading.fetchedAt * 1000).toISOString(),
    sourceKind: "codex_app_server",
    accuracy: q.used === null ? "unknown" : "source_reported",
    freshness: "fresh",
    capabilityStatus: "experimental",
  }));
}
export const errors: Record<string, string> = {
  session_updated: "Codex refreshed its sign-in session during this read. No new values were saved. Try Refresh again.",
  consent_required: "Your permission is required for this reading.",
  cli_missing: "Codex CLI was not found. Install it and sign in to Codex.",
  not_signed_in: "Codex CLI is not signed in. Sign in and try again.",
  unsupported_account:
    "This is not a ChatGPT subscription session. API keys do not expose this quota.",
  identity_unknown: "Could not verify the account. Reading stopped.",
  account_changed:
    "Your account or plan changed. Connect again to read the current account.",
  format_changed:
    "The source returned an unknown format. No default values were substituted.",
  source_error:
    "Codex declined the reading. Check your session and service availability; retries are manual.",
  timeout: "Reading stopped after a 20-second timeout.",
  busy: "A reading is already in progress.",
  cancelled: "Reading cancelled.",
  transport_error: "Could not communicate with Codex CLI.",
  transport_closed: "Codex closed the connection before returning data.",
};

/** Preserve actual source pools. A missing window is never synthesized. */
export function stripPools(
  quotas: QuotaSnapshot[],
  preferred?: string,
): QuotaSnapshot[] {
  if (!quotas.length) return [];
  const first = quotas.find((q) => q.poolId === preferred) ?? quotas[0];
  const second =
    quotas.find(
      (q) =>
        q.poolId !== first.poolId && q.windowDuration !== first.windowDuration,
    ) ?? quotas.find((q) => q.poolId !== first.poolId);
  return (second ? [first, second] : [first]).sort(
    (a, b) => (a.windowDuration ?? Infinity) - (b.windowDuration ?? Infinity),
  );
}
export function compactWindow(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "?";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

export function readingAge(date: string | null, now: number): string {
  if (
    !date ||
    !Number.isFinite(Date.parse(date)) ||
    Date.parse(date) > now + 60000
  )
    return "Reading time unavailable";
  const minutes = Math.max(0, Math.floor((now - Date.parse(date)) / 60000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  if (minutes < 1440) return `Updated ${Math.floor(minutes / 60)} h ago`;
  return `Updated ${Math.floor(minutes / 1440)} d ago`;
}
export function visibleProviders(hidden: Provider[]): Provider[] {
  const visible = providers.filter((p) => !hidden.includes(p));
  return visible.length ? visible : ["Codex"];
}
