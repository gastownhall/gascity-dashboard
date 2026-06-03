import type {
  GitCommitList,
  GitView,
  DeployList,
  SystemHealth,
  LocalToolVersions,
  DoltNomsTrend,
  MaintainerTriage,
  ContributorStat,
  ApiError,
  DashboardRuntimeConfig,
  RunDiffRequest,
  RunDiffResponse,
  RunScopeKind,
} from 'gas-city-dashboard-shared';
import { readCsrfToken } from './csrf';
import { cityPath } from './cityBase';

// Typed fetch client for the admin backend's API. Shares types with the
// backend via the workspace 'gas-city-dashboard-shared' import so wire-shape
// drift produces compile errors instead of runtime undefined.
//
// gascity-dashboard-ucc: the request plane is split. City-scoped reads/writes
// address `/api/city/:cityName/*` via `cityPath()` (the active city is set by
// the router from the URL segment). Non-city dashboard-service endpoints —
// health, csrf, client-error telemetry, git, builds — address `/api/*`
// directly because they are dashboard-local, not GC-owned supervisor resources.

async function performRequest<T>(
  method: 'GET' | 'POST',
  url: string,
  decode: ResponseDecoder<T>,
  body?: object,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = readCsrfToken();
    if (token.status === 'available') headers['X-CSRF-Token'] = token.token;
  }
  const init: RequestInit = {
    method,
    headers,
    credentials: 'same-origin',
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  if (!res.ok) {
    const bodyText = await res.text();
    const payload = parseApiErrorBody(bodyText);
    const message = payload?.error ?? (bodyText.trim() || res.statusText || `HTTP ${res.status}`);
    throw new ApiClientError(res.status, message, payload?.kind);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new ApiResponseDecodeError(url, `body must be valid JSON: ${unknownMessage(err)}`);
  }
  return decode(json, url);
}

function parseApiErrorBody(bodyText: string): ApiError | undefined {
  if (bodyText.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    return isApiError(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.error !== 'string') return false;
  return record.kind === undefined || typeof record.kind === 'string';
}

// In dev, `tsx watch` restarts the backend on every source edit, which
// rotates the in-process CSRF bootToken. The browser's cookie stays
// stale until the next GET response refreshes it, so the first
// mutation after a restart 403s with kind:'csrf'. Self-heal by doing a
// one-shot GET /api/csrf (which sets a fresh cookie) and replaying the
// original request exactly once. Only retries on the precise
// csrf-token mismatch — no other error class triggers a replay.
async function request<T>(
  method: 'GET' | 'POST',
  url: string,
  decode: ResponseDecoder<T>,
  body?: object,
): Promise<T> {
  try {
    return await performRequest<T>(method, url, decode, body);
  } catch (err) {
    if (
      err instanceof ApiClientError &&
      err.status === 403 &&
      err.kind === 'csrf' &&
      method !== 'GET'
    ) {
      await fetch('/api/csrf', { credentials: 'same-origin' });
      return await performRequest<T>(method, url, decode, body);
    }
    throw err;
  }
}

type JsonRecord = Record<string, unknown>;
type ResponseDecoder<T> = (value: unknown, url: string) => T;

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly kind?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ApiResponseDecodeError extends Error {
  constructor(
    public readonly url: string,
    public readonly detail: string,
  ) {
    super(`Invalid API response for ${url}: ${detail}`);
    this.name = 'ApiResponseDecodeError';
  }
}

function unknownMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

function failDecode(url: string, detail: string): never {
  throw new ApiResponseDecodeError(url, detail);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, url: string, label: string): JsonRecord {
  if (!isRecord(value)) failDecode(url, `${label} must be an object`);
  return value;
}

function requireStringField(record: JsonRecord, url: string, label: string, field: string): void {
  if (typeof record[field] !== 'string') failDecode(url, `${label}.${field} must be a string`);
}

function requireNullableStringField(
  record: JsonRecord,
  url: string,
  label: string,
  field: string,
): void {
  const value = record[field];
  if (value !== null && typeof value !== 'string') {
    failDecode(url, `${label}.${field} must be a string or null`);
  }
}

function requireBooleanField(record: JsonRecord, url: string, label: string, field: string): void {
  if (typeof record[field] !== 'boolean') failDecode(url, `${label}.${field} must be a boolean`);
}

function requireArrayField(record: JsonRecord, url: string, label: string, field: string): void {
  if (!Array.isArray(record[field])) failDecode(url, `${label}.${field} must be an array`);
}

function requireObjectField(record: JsonRecord, url: string, label: string, field: string): void {
  requireRecord(record[field], url, `${label}.${field}`);
}

function requireTrueField(record: JsonRecord, url: string, label: string, field: string): void {
  if (record[field] !== true) failDecode(url, `${label}.${field} must be true`);
}

function requireStringArrayOrNullField(
  record: JsonRecord,
  url: string,
  label: string,
  field: string,
): void {
  const value = record[field];
  if (value === null) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    failDecode(url, `${label}.${field} must be an array of strings or null`);
  }
}

function requireOptionalStringField(
  record: JsonRecord,
  url: string,
  label: string,
  field: string,
): void {
  if (record[field] !== undefined && typeof record[field] !== 'string') {
    failDecode(url, `${label}.${field} must be a string when present`);
  }
}

function objectDecoder<T>(
  label: string,
  validate?: (record: JsonRecord, url: string) => void,
): ResponseDecoder<T> {
  return (value, url) => {
    const record = requireRecord(value, url, label);
    validate?.(record, url);
    return record as T;
  };
}

function itemsDecoder<T>(label: string, validate?: (record: JsonRecord, url: string) => void): ResponseDecoder<T> {
  return objectDecoder<T>(label, (record, url) => {
    requireArrayField(record, url, label, 'items');
    validate?.(record, url);
  });
}

const decodeHealth = objectDecoder<{ ok: boolean; ts: string }>('health', (record, url) => {
  requireBooleanField(record, url, 'health', 'ok');
  requireStringField(record, url, 'health', 'ts');
});

const decodeCommitList = itemsDecoder<GitCommitList>('commits', (record, url) => {
  requireStringField(record, url, 'commits', 'view');
});
const decodeBuildList = itemsDecoder<DeployList>('builds', (record, url) => {
  requireNullableStringField(record, url, 'builds', 'source');
  requireBooleanField(record, url, 'builds', 'failed_marker');
});
const decodeRuntimeConfig = objectDecoder<DashboardRuntimeConfig>('config', (record, url) => {
  requireStringField(record, url, 'config', 'cityName');
  requireStringField(record, url, 'config', 'cityRoot');
  requireBooleanField(record, url, 'config', 'useFixtures');
  requireStringArrayOrNullField(record, url, 'config', 'enabledModules');
  requireNullableStringField(record, url, 'config', 'defaultView');
});
const decodeSystemHealth = objectDecoder<SystemHealth>('system health', (record, url) => {
  requireObjectField(record, url, 'system health', 'admin');
  requireObjectField(record, url, 'system health', 'host');
});
const decodeLocalToolVersions = objectDecoder<LocalToolVersions>('local tool versions', (record, url) => {
  requireObjectField(record, url, 'local tool versions', 'dolt');
  requireObjectField(record, url, 'local tool versions', 'beads');
});
const decodeDoltTrend = objectDecoder<DoltNomsTrend>('dolt trend', (record, url) => {
  requireBooleanField(record, url, 'dolt trend', 'available');
  requireArrayField(record, url, 'dolt trend', 'samples');
});
const decodeRunDiff = objectDecoder<RunDiffResponse>('run diff', (record, url) => {
  requireStringField(record, url, 'run diff', 'kind');
  requireObjectField(record, url, 'run diff', 'rootPath');
  requireObjectField(record, url, 'run diff', 'comparison');
  requireArrayField(record, url, 'run diff', 'status');
  requireArrayField(record, url, 'run diff', 'changedFiles');
  requireStringField(record, url, 'run diff', 'patch');
  requireBooleanField(record, url, 'run diff', 'truncated');
});
const decodeMaintainerTriage = objectDecoder<MaintainerTriage>('maintainer triage', (record, url) => {
  requireNullableStringField(record, url, 'maintainer triage', 'computed_at');
  requireStringField(record, url, 'maintainer triage', 'repo');
  requireArrayField(record, url, 'maintainer triage', 'tiers');
  requireObjectField(record, url, 'maintainer triage', 'totals');
});
const decodeContributor = objectDecoder<ContributorStat>('contributor', (record, url) => {
  requireStringField(record, url, 'contributor', 'login');
});
const decodeMaintainerSling = objectDecoder<{ ok: true; bead_id?: string }>('maintainer sling', (record, url) => {
  requireTrueField(record, url, 'maintainer sling', 'ok');
  requireOptionalStringField(record, url, 'maintainer sling', 'bead_id');
});

export interface ApiErrorParts {
  message: string;
  status?: number;
  kind?: string;
}

export function apiErrorParts(err: unknown, fallback = 'request failed'): ApiErrorParts {
  if (err instanceof ApiClientError) {
    const parts: ApiErrorParts = { message: err.message, status: err.status };
    if (err.kind !== undefined) parts.kind = err.kind;
    return parts;
  }
  if (err instanceof Error) return { message: err.message };
  return { message: fallback };
}

export function formatApiError(err: unknown, fallback = 'request failed'): string {
  const parts = apiErrorParts(err, fallback);
  return parts.status === undefined ? parts.message : `${parts.status} ${parts.message}`;
}

export const api = {
  // ── Non-city (supervisor / host-global) endpoints ──────────────────────
  health(): Promise<{ ok: boolean; ts: string }> {
    return request('GET', '/api/health', decodeHealth);
  },
  listCommits(view: GitView): Promise<GitCommitList> {
    return request('GET', `/api/git/commits?view=${encodeURIComponent(view)}`, decodeCommitList);
  },
  listBuilds(): Promise<DeployList> {
    return request('GET', '/api/builds', decodeBuildList);
  },

  // ── City-scoped endpoints (ride /api/city/:cityName/*) ─────────────────
  config(): Promise<DashboardRuntimeConfig> {
    return request('GET', cityPath('/config'), decodeRuntimeConfig);
  },
  systemHealth(): Promise<SystemHealth> {
    return request('GET', '/api/health/system', decodeSystemHealth);
  },
  localToolVersions(): Promise<LocalToolVersions> {
    return request('GET', '/api/health/local-tools', decodeLocalToolVersions);
  },
  doltTrend(): Promise<DoltNomsTrend> {
    return request('GET', cityPath('/dolt-noms/trend'), decodeDoltTrend);
  },
  runDiff(
    runId: string,
    body: RunDiffRequest,
    params?: { scopeKind?: RunScopeKind; scopeRef?: string },
  ): Promise<RunDiffResponse> {
    const qs = runQuery(params);
    return request('POST', cityPath(`/runs/${encodeURIComponent(runId)}/diff${qs}`), decodeRunDiff, body);
  },
  maintainerTriage(): Promise<MaintainerTriage> {
    return request('GET', cityPath('/maintainer/triage'), decodeMaintainerTriage);
  },
  maintainerRefresh(): Promise<MaintainerTriage> {
    return request('POST', cityPath('/maintainer/refresh'), decodeMaintainerTriage, {});
  },
  maintainerContributor(login: string): Promise<ContributorStat> {
    return request('GET', cityPath(`/maintainer/contributor/${encodeURIComponent(login)}`), decodeContributor);
  },
  // gascity-dashboard-0nn: per-item sling dispatch. The bulk-sling
  // action bar fans out one call per selected item via Promise.allSettled
  // so a single 4xx/5xx doesn't block the rest of the batch.
  maintainerSling(payload: {
    kind: 'pr' | 'issue';
    number: number;
    html_url: string;
    intent: 'review' | 'draft' | 'triage';
    target?: string;
  }): Promise<{ ok: true; bead_id?: string }> {
    return request('POST', cityPath('/maintainer/sling'), decodeMaintainerSling, payload);
  },
};

function runQuery(params?: { scopeKind?: RunScopeKind; scopeRef?: string }): string {
  const search = new URLSearchParams();
  if (params?.scopeKind && params.scopeRef) {
    search.set('scope_kind', params.scopeKind);
    search.set('scope_ref', params.scopeRef);
  }
  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : '';
}
