import type {
  GcAgentList,
  GcSession,
  GcBead,
  GcMailItem,
  TranscriptResult,
  MailComposeRequest,
  MailSendResult,
  SystemHealth,
  DoltNomsTrend,
  MaintainerTriage,
  ContributorStat,
  ApiError,
  CityList,
  DashboardSnapshot,
  SourceName,
  DashboardRuntimeConfig,
  RunDiffResponse,
  FormulaRunDetail,
  RunScopeKind,
  EntityLinkView,
} from 'gas-city-dashboard-shared';
import { readCsrfToken } from './csrf';
import { cityPath } from './cityBase';

// Typed fetch client for the admin backend's API. Shares types with the
// backend via the workspace 'gas-city-dashboard-shared' import so wire-shape
// drift produces compile errors instead of runtime undefined.
//
// gascity-dashboard-ucc: the request plane is split. City-scoped reads/writes
// address `/api/city/:cityName/*` via `cityPath()` (the active city is set by
// the router from the URL segment). Non-city endpoints — health, csrf, the
// city switcher list, client-error telemetry, git, builds — address `/api/*`
// directly because they are supervisor- or host-global, not per-city.

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

function requireNumberField(record: JsonRecord, url: string, label: string, field: string): void {
  if (typeof record[field] !== 'number') failDecode(url, `${label}.${field} must be a number`);
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

function requireOptionalNumberField(
  record: JsonRecord,
  url: string,
  label: string,
  field: string,
): void {
  if (record[field] !== undefined && typeof record[field] !== 'number') {
    failDecode(url, `${label}.${field} must be a number when present`);
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

function countedItemsDecoder<T>(
  label: string,
  validate?: (record: JsonRecord, url: string) => void,
): ResponseDecoder<T> {
  return itemsDecoder<T>(label, (record, url) => {
    requireNumberField(record, url, label, 'total');
    validate?.(record, url);
  });
}

const decodeHealth = objectDecoder<{ ok: boolean; ts: string }>('health', (record, url) => {
  requireBooleanField(record, url, 'health', 'ok');
  requireStringField(record, url, 'health', 'ts');
});

const decodeCityList = countedItemsDecoder<CityList>('cities');
const decodeSessionList = itemsDecoder<{ items: GcSession[] }>('sessions');
const decodeAgentList = itemsDecoder<GcAgentList>('agents');
const decodeTranscript = objectDecoder<TranscriptResult>('transcript', (record, url) => {
  requireStringField(record, url, 'transcript', 'session_id');
  requireArrayField(record, url, 'transcript', 'turns');
  requireNumberField(record, url, 'transcript', 'total_chars');
  requireStringField(record, url, 'transcript', 'captured_at');
  requireBooleanField(record, url, 'transcript', 'truncated');
});
const decodeBeadList = countedItemsDecoder<{
  items: GcBead[];
  total: number;
  upstream_total?: number;
  upstream_fetched?: number;
  fetch_limit?: number;
}>('beads', (record, url) => {
  requireOptionalNumberField(record, url, 'beads', 'upstream_total');
  requireOptionalNumberField(record, url, 'beads', 'upstream_fetched');
  requireOptionalNumberField(record, url, 'beads', 'fetch_limit');
});
const decodeBead = objectDecoder<GcBead>('bead', (record, url) => {
  requireStringField(record, url, 'bead', 'id');
  requireStringField(record, url, 'bead', 'title');
  requireStringField(record, url, 'bead', 'status');
});
const decodeBeadAction = objectDecoder<{ ok: true; stdout: string }>('bead action', (record, url) => {
  requireTrueField(record, url, 'bead action', 'ok');
  requireStringField(record, url, 'bead action', 'stdout');
});
const decodeMailList = countedItemsDecoder<{ items: GcMailItem[]; total: number }>('mail');
const decodeThread = itemsDecoder<{ items: GcMailItem[] }>('thread');
const decodeMailSend = objectDecoder<MailSendResult>('mail send', (record, url) => {
  requireTrueField(record, url, 'mail send', 'ok');
  requireOptionalStringField(record, url, 'mail send', 'message_id');
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
  requireObjectField(record, url, 'system health', 'supervisor');
});
const decodeDoltTrend = objectDecoder<DoltNomsTrend>('dolt trend', (record, url) => {
  requireBooleanField(record, url, 'dolt trend', 'available');
  requireArrayField(record, url, 'dolt trend', 'samples');
});
const decodeAgentPrime = objectDecoder<{ agent: string; prompt: string; bytes: number }>('agent prime', (record, url) => {
  requireStringField(record, url, 'agent prime', 'agent');
  requireStringField(record, url, 'agent prime', 'prompt');
  requireNumberField(record, url, 'agent prime', 'bytes');
});
const decodeSnapshot = objectDecoder<DashboardSnapshot>('snapshot', (record, url) => {
  requireStringField(record, url, 'snapshot', 'generatedAt');
  requireObjectField(record, url, 'snapshot', 'config');
  requireObjectField(record, url, 'snapshot', 'headline');
  requireObjectField(record, url, 'snapshot', 'sources');
});
const decodeFormulaRun = objectDecoder<FormulaRunDetail>('formula run', (record, url) => {
  requireStringField(record, url, 'formula run', 'runId');
  requireStringField(record, url, 'formula run', 'rootBeadId');
  requireStringField(record, url, 'formula run', 'title');
  requireNumberField(record, url, 'formula run', 'snapshotVersion');
  requireObjectField(record, url, 'formula run', 'formula');
  requireObjectField(record, url, 'formula run', 'formulaDetail');
  requireArrayField(record, url, 'formula run', 'nodes');
  requireArrayField(record, url, 'formula run', 'edges');
  requireArrayField(record, url, 'formula run', 'lanes');
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
const decodeEntityLinks = objectDecoder<EntityLinkView>('entity links', (record, url) => {
  requireObjectField(record, url, 'entity links', 'focus');
  requireArrayField(record, url, 'entity links', 'nodes');
  requireArrayField(record, url, 'entity links', 'edges');
  requireArrayField(record, url, 'entity links', 'stats');
  requireBooleanField(record, url, 'entity links', 'partial');
  requireStringField(record, url, 'entity links', 'generatedAt');
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
  // The city switcher source. Lists every managed city (host path stripped
  // server-side). Not city-scoped — it is the registry the switcher reads.
  listCities(): Promise<CityList> {
    return request('GET', '/api/cities', decodeCityList);
  },

  // ── City-scoped endpoints (ride /api/city/:cityName/*) ─────────────────
  listSessions(): Promise<{ items: GcSession[] }> {
    return request('GET', cityPath('/sessions'), decodeSessionList);
  },
  // gascity-dashboard-ay6: canonical agent roster. Supersedes the
  // session-derived Agents-view path which under-counted configured
  // agents that were not currently running. Return type IS the shared
  // GcAgentList SSOT — `partial` + `partial_errors` are part of that
  // type and will widen automatically if upstream grows the envelope.
  listAgents(): Promise<GcAgentList> {
    return request('GET', cityPath('/agents'), decodeAgentList);
  },
  peekSession(id: string): Promise<TranscriptResult> {
    return request('POST', cityPath(`/sessions/${encodeURIComponent(id)}/peek`), decodeTranscript, {});
  },
  listBeads(showAll?: boolean): Promise<{
    items: GcBead[];
    total: number;
    upstream_total?: number;
    upstream_fetched?: number;
    fetch_limit?: number;
  }> {
    const qs = showAll ? '?showAll=1' : '';
    return request('GET', cityPath(`/beads${qs}`), decodeBeadList);
  },
  getBead(id: string): Promise<GcBead> {
    return request('GET', cityPath(`/beads/${encodeURIComponent(id)}`), decodeBead);
  },
  claimBead(id: string): Promise<{ ok: true; stdout: string }> {
    return request('POST', cityPath(`/beads/${encodeURIComponent(id)}/claim`), decodeBeadAction, {});
  },
  closeBead(id: string, reason?: string): Promise<{ ok: true; stdout: string }> {
    return request('POST', cityPath(`/beads/${encodeURIComponent(id)}/close`), decodeBeadAction, { reason });
  },
  nudgeBead(id: string): Promise<{ ok: true; stdout: string }> {
    return request('POST', cityPath(`/beads/${encodeURIComponent(id)}/nudge`), decodeBeadAction, {});
  },
  listMail(box: 'inbox' | 'sent' | 'all', alias: string): Promise<{ items: GcMailItem[]; total: number }> {
    const qs = new URLSearchParams({ box, alias }).toString();
    return request('GET', cityPath(`/mail?${qs}`), decodeMailList);
  },
  getThread(threadId: string, alias: string): Promise<{ items: GcMailItem[] }> {
    const qs = new URLSearchParams({ alias }).toString();
    return request('GET', cityPath(`/mail/threads/${encodeURIComponent(threadId)}?${qs}`), decodeThread);
  },
  sendMail(payload: MailComposeRequest): Promise<MailSendResult> {
    // The client-side shape mirrors the server's: { to, subject, body }.
    // No `from` field. The architect's physical-separation rule means
    // this fetch hits a different router than reads.
    return request('POST', cityPath('/mail-send'), decodeMailSend, payload);
  },
  config(): Promise<DashboardRuntimeConfig> {
    return request('GET', cityPath('/config'), decodeRuntimeConfig);
  },
  systemHealth(): Promise<SystemHealth> {
    return request('GET', cityPath('/health/system'), decodeSystemHealth);
  },
  doltTrend(): Promise<DoltNomsTrend> {
    return request('GET', cityPath('/dolt-noms/trend'), decodeDoltTrend);
  },
  agentPrime(alias: string): Promise<{ agent: string; prompt: string; bytes: number }> {
    return request('GET', cityPath(`/agents/${encodeURIComponent(alias)}/prime`), decodeAgentPrime);
  },
  snapshot(): Promise<DashboardSnapshot> {
    return request('GET', cityPath('/snapshot'), decodeSnapshot);
  },
  // Bypasses the backend's per-source TTL — POSTs through
  // SnapshotService.refresh which forces a fresh upstream load on the
  // listed sources (or all sources when `sources` is omitted). Used by
  // the /runs live-updates path so SSE-triggered re-fetches see
  // genuinely fresh data (gascity-dashboard-bqn).
  snapshotRefresh(sources?: readonly SourceName[]): Promise<DashboardSnapshot> {
    // Backend rejects [] explicitly (snapshot.ts:83 — "sources must not
    // be empty; omit the field to refresh all"). Guard here so callers
    // get a TypeScript-side no-op rather than a 400 from a stray empty
    // array. Pass undefined / non-empty arrays through.
    const body = sources && sources.length > 0 ? { sources } : {};
    return request('POST', cityPath('/snapshot/refresh'), decodeSnapshot, body);
  },
  formulaRun(
    runId: string,
    params?: { scopeKind?: RunScopeKind; scopeRef?: string; refresh?: boolean },
  ): Promise<FormulaRunDetail> {
    const qs = runQuery(params);
    return request('GET', cityPath(`/runs/${encodeURIComponent(runId)}${qs}`), decodeFormulaRun);
  },
  runDiff(
    runId: string,
    params?: { scopeKind?: RunScopeKind; scopeRef?: string; refresh?: boolean },
  ): Promise<RunDiffResponse> {
    const qs = runQuery(params);
    return request('GET', cityPath(`/runs/${encodeURIComponent(runId)}/diff${qs}`), decodeRunDiff);
  },
  sessionStreamUrl(id: string): string {
    // Distinct from /sessions (REST) — the session SSE stream mounts under
    // its own /session-stream prefix on the backend (see city/runtime.ts).
    return cityPath(`/session-stream/${encodeURIComponent(id)}/stream`);
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
  // Bead-ID cross-entity linked view (gascity-dashboard-j4x). `ref` is a
  // bead id, `pr/<n>`, `issue/<n>`, a session id, or a run id.
  entityLinks(ref: string): Promise<EntityLinkView> {
    return request('GET', cityPath(`/links/${encodeURIComponent(ref)}`), decodeEntityLinks);
  },
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

function runQuery(params?: {
  scopeKind?: RunScopeKind;
  scopeRef?: string;
  refresh?: boolean;
}): string {
  const search = new URLSearchParams();
  if (params?.scopeKind && params.scopeRef) {
    search.set('scope_kind', params.scopeKind);
    search.set('scope_ref', params.scopeRef);
  }
  // `refresh=1` forces the backend run-detail cache to re-fetch from the
  // supervisor (gascity-dashboard-wqsk) — used by the detail page's explicit
  // Refresh + SSE-driven refresh so a deliberate refresh never serves stale.
  if (params?.refresh) search.set('refresh', '1');
  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : '';
}
