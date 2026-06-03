import {
  createClient,
  type Client as GeneratedSupervisorClient,
} from '@hey-api/client-fetch';
import {
  createBead as postSupervisorBead,
  getHealth,
  getV0Cities,
  getV0CityByCityNameAgents,
  getV0CityByCityNameAgentByBasePrime,
  getV0CityByCityNameAgentByDirByBasePrime,
  getV0CityByCityNameBeadById,
  getV0CityByCityNameBeads,
  getV0CityByCityNameEvents,
  getV0CityByCityNameFormulasByName,
  getV0CityByCityNameFormulasFeed,
  getV0CityByCityNameHealth,
  getV0CityByCityNameMail,
  getV0CityByCityNameMailThreadById,
  getV0CityByCityNameSessionByIdPending,
  getV0CityByCityNameSessionByIdTranscript,
  getV0CityByCityNameSessions,
  getV0CityByCityNameStatus,
  getV0CityByCityNameWorkflowByWorkflowId,
  patchV0CityByCityNameBeadById,
  postV0CityByCityNameAgentByBaseByAction,
  postV0CityByCityNameAgentByDirByBaseByAction,
  postV0CityByCityNameBeadByIdClose,
  postV0CityByCityNameSling,
  postV0CityByCityNameMailByIdArchive,
  postV0CityByCityNameMailByIdMarkUnread,
  postV0CityByCityNameMailByIdRead,
  replyMail as postSupervisorMailReply,
  respondSession as postSupervisorSessionRespond,
  sendMail as postSupervisorMail,
} from '../generated/gc-supervisor-client/sdk.gen';
import type {
  Bead,
  BeadCloseBody,
  BeadCreateInputBody,
  BeadUpdateBody,
  AgentPrimeBody,
  FormulaFeedBody,
  GetV0CityByCityNameBeadsData,
  GetV0CityByCityNameEventsData,
  GetV0CityByCityNameFormulasFeedData,
  GetV0CityByCityNameFormulasByNameData,
  GetHealthResponse,
  GetV0CityByCityNameHealthResponse,
  GetV0CityByCityNameMailData,
  GetV0CityByCityNameStatusResponse,
  GetV0CityByCityNameWorkflowByWorkflowIdData,
  ListBodyBead,
  ListBodyAgentResponse,
  ListBodyWireEvent,
  MailReplyInputBody,
  MailSendInputBody,
  FormulaDetailResponse,
  MailListBody,
  Message,
  ListBodySessionResponse,
  OkResponseBody,
  PostV0CityByCityNameMailByIdArchiveData,
  PostV0CityByCityNameMailByIdMarkUnreadData,
  PostV0CityByCityNameMailByIdReadData,
  ReplyMailData,
  RespondSessionResponse,
  SessionTranscriptGetResponse,
  SessionPendingResponse,
  SessionRespondInputBody,
  SlingInputBody,
  SlingResponse,
  SupervisorCitiesOutputBody,
  WorkflowSnapshotResponse,
} from '../generated/gc-supervisor-client/types.gen';

export const SUPERVISOR_PROXY_BASE_URL = '/gc-supervisor';
export const GC_MUTATION_HEADERS = {
  'X-GC-Request': 'dashboard',
} as const;

export interface SupervisorApi {
  readonly baseUrl: string;
  health(): Promise<GetHealthResponse>;
  cityHealth(cityName: string): Promise<GetV0CityByCityNameHealthResponse>;
  cityStatus(cityName: string): Promise<GetV0CityByCityNameStatusResponse>;
  listCities(): Promise<SupervisorCitiesOutputBody>;
  listAgents(cityName: string): Promise<ListBodyAgentResponse>;
  listBeads(
    cityName: string,
    query?: NonNullable<GetV0CityByCityNameBeadsData['query']>,
  ): Promise<ListBodyBead>;
  listEvents(
    cityName: string,
    query?: NonNullable<GetV0CityByCityNameEventsData['query']>,
  ): Promise<ListBodyWireEvent>;
  getBead(cityName: string, id: string): Promise<Bead>;
  createBead(cityName: string, body: BeadCreateInputBody): Promise<Bead>;
  updateBead(cityName: string, id: string, body: BeadUpdateBody): Promise<OkResponseBody>;
  closeBead(cityName: string, id: string, body?: BeadCloseBody): Promise<OkResponseBody>;
  nudgeAgent(cityName: string, agentAlias: string): Promise<OkResponseBody>;
  agentPrime(cityName: string, agentAlias: string): Promise<AgentPrimeBody>;
  sling(cityName: string, body: SlingInputBody): Promise<SlingResponse>;
  listMail(
    cityName: string,
    query?: NonNullable<GetV0CityByCityNameMailData['query']>,
  ): Promise<MailListBody>;
  formulaFeed(
    cityName: string,
    query?: NonNullable<GetV0CityByCityNameFormulasFeedData['query']>,
  ): Promise<FormulaFeedBody>;
  sendMail(cityName: string, body: MailSendInputBody): Promise<Message>;
  mailThread(cityName: string, threadId: string): Promise<MailListBody>;
  markMailRead(
    cityName: string,
    id: string,
    query?: NonNullable<PostV0CityByCityNameMailByIdReadData['query']>,
  ): Promise<OkResponseBody>;
  markMailUnread(
    cityName: string,
    id: string,
    query?: NonNullable<PostV0CityByCityNameMailByIdMarkUnreadData['query']>,
  ): Promise<OkResponseBody>;
  archiveMail(
    cityName: string,
    id: string,
    query?: NonNullable<PostV0CityByCityNameMailByIdArchiveData['query']>,
  ): Promise<OkResponseBody>;
  replyMail(
    cityName: string,
    id: string,
    body: MailReplyInputBody,
    query?: NonNullable<ReplyMailData['query']>,
  ): Promise<Message>;
  cityEventStreamUrl(cityName: string, afterSeq?: string): string;
  sessionStreamUrl(cityName: string, sessionId: string, after?: string): string;
  listSessions(cityName: string): Promise<ListBodySessionResponse>;
  sessionPending(cityName: string, sessionId: string): Promise<SessionPendingResponse>;
  respondSession(
    cityName: string,
    sessionId: string,
    body: SessionRespondInputBody,
  ): Promise<RespondSessionResponse>;
  sessionTranscript(
    cityName: string,
    sessionId: string,
  ): Promise<SessionTranscriptGetResponse>;
  workflowRun(
    cityName: string,
    workflowId: string,
    query?: NonNullable<GetV0CityByCityNameWorkflowByWorkflowIdData['query']>,
  ): Promise<WorkflowSnapshotResponse>;
  formulaDetail(
    cityName: string,
    name: string,
    query: GetV0CityByCityNameFormulasByNameData['query'],
  ): Promise<FormulaDetailResponse>;
  mutationHeaders(): Record<keyof typeof GC_MUTATION_HEADERS, string>;
}

export interface CreateSupervisorApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  client?: GeneratedSupervisorClient;
}

type SupervisorResult<T> = {
  data?: T;
  error?: unknown;
  response?: Response;
};

const SUPERVISOR_SCHEMA_VALIDATION_MESSAGE = 'gc supervisor response failed validation';

let testSupervisorApi: SupervisorApi | null = null;
let defaultSupervisorApi: SupervisorApi | null = null;

export class SupervisorApiError extends Error {
  override readonly name = 'SupervisorApiError';

  constructor(
    public readonly status: number | undefined,
    message: string,
    public readonly requestId: string | undefined,
  ) {
    super(message);
  }
}

export function createSupervisorApi(
  options: CreateSupervisorApiOptions = {},
): SupervisorApi {
  const baseUrl = options.baseUrl ?? resolveSupervisorBaseUrl();
  const clientBaseUrl = resolveClientBaseUrl(baseUrl);
  const clientOptions = {
    baseUrl: clientBaseUrl,
    headers: { Accept: 'application/json' },
    responseStyle: 'fields' as const,
    throwOnError: false,
  };
  const client = options.client ?? createClient(
    options.fetch === undefined
      ? clientOptions
      : { ...clientOptions, fetch: options.fetch },
  );

  return {
    baseUrl,
    health() {
      return unwrapSupervisorResult<GetHealthResponse>(
        getHealth({ client }) as Promise<SupervisorResult<GetHealthResponse>>,
        'gc supervisor health response was empty',
      );
    },
    cityHealth(cityName) {
      return unwrapSupervisorResult<GetV0CityByCityNameHealthResponse>(
        getV0CityByCityNameHealth({
          client,
          path: { cityName },
        }) as Promise<SupervisorResult<GetV0CityByCityNameHealthResponse>>,
        'gc supervisor city health response was empty',
      );
    },
    cityStatus(cityName) {
      return unwrapSupervisorResult<GetV0CityByCityNameStatusResponse>(
        getV0CityByCityNameStatus({
          client,
          path: { cityName },
        }) as Promise<SupervisorResult<GetV0CityByCityNameStatusResponse>>,
        'gc supervisor status response was empty',
      );
    },
    listCities() {
      return unwrapSupervisorResult<SupervisorCitiesOutputBody>(
        getV0Cities({ client }) as Promise<SupervisorResult<SupervisorCitiesOutputBody>>,
        'gc supervisor cities response was empty',
      );
    },
    listAgents(cityName) {
      return unwrapSupervisorResult<ListBodyAgentResponse>(
        getV0CityByCityNameAgents({
          client,
          path: { cityName },
        }) as Promise<SupervisorResult<ListBodyAgentResponse>>,
        'gc supervisor agents response was empty',
      );
    },
    listBeads(cityName, query) {
      return unwrapSupervisorResult<ListBodyBead>(
        getV0CityByCityNameBeads({
          client,
          path: { cityName },
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<ListBodyBead>>,
        'gc supervisor beads response was empty',
      );
    },
    listEvents(cityName, query) {
      return unwrapSupervisorResult<ListBodyWireEvent>(
        getV0CityByCityNameEvents({
          client,
          path: { cityName },
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<ListBodyWireEvent>>,
        'gc supervisor events response was empty',
      );
    },
    getBead(cityName, id) {
      return unwrapSupervisorResult<Bead>(
        getV0CityByCityNameBeadById({
          client,
          path: { cityName, id },
        }) as Promise<SupervisorResult<Bead>>,
        'gc supervisor bead response was empty',
      );
    },
    createBead(cityName, body) {
      return unwrapSupervisorResult<Bead>(
        postSupervisorBead({
          client,
          path: { cityName },
          headers: GC_MUTATION_HEADERS,
          body,
        }) as Promise<SupervisorResult<Bead>>,
        'gc supervisor bead create response was empty',
      );
    },
    updateBead(cityName, id, body) {
      return unwrapSupervisorResult<OkResponseBody>(
        patchV0CityByCityNameBeadById({
          client,
          path: { cityName, id },
          headers: GC_MUTATION_HEADERS,
          body,
        }) as Promise<SupervisorResult<OkResponseBody>>,
        'gc supervisor bead update response was empty',
      );
    },
    closeBead(cityName, id, body) {
      return unwrapSupervisorResult<OkResponseBody>(
        postV0CityByCityNameBeadByIdClose({
          client,
          path: { cityName, id },
          headers: GC_MUTATION_HEADERS,
          ...(body === undefined ? {} : { body }),
        }) as Promise<SupervisorResult<OkResponseBody>>,
        'gc supervisor bead close response was empty',
      );
    },
    nudgeAgent(cityName, agentAlias) {
      const aliasPath = splitAgentAlias(agentAlias);
      if ('dir' in aliasPath) {
        return unwrapSupervisorResult<OkResponseBody>(
          postV0CityByCityNameAgentByDirByBaseByAction({
            client,
            path: { cityName, dir: aliasPath.dir, base: aliasPath.base, action: 'nudge' },
            headers: GC_MUTATION_HEADERS,
          }) as Promise<SupervisorResult<OkResponseBody>>,
          'gc supervisor agent nudge response was empty',
        );
      }
      return unwrapSupervisorResult<OkResponseBody>(
        postV0CityByCityNameAgentByBaseByAction({
          client,
          path: { cityName, base: aliasPath.base, action: 'nudge' },
          headers: GC_MUTATION_HEADERS,
        }) as Promise<SupervisorResult<OkResponseBody>>,
        'gc supervisor agent nudge response was empty',
      );
    },
    agentPrime(cityName, agentAlias) {
      const aliasPath = splitAgentAlias(agentAlias);
      if ('dir' in aliasPath) {
        return unwrapSupervisorResult<AgentPrimeBody>(
          getV0CityByCityNameAgentByDirByBasePrime({
            client,
            path: { cityName, dir: aliasPath.dir, base: aliasPath.base },
          }) as Promise<SupervisorResult<AgentPrimeBody>>,
          'gc supervisor agent prime response was empty',
        );
      }
      return unwrapSupervisorResult<AgentPrimeBody>(
        getV0CityByCityNameAgentByBasePrime({
          client,
          path: { cityName, base: aliasPath.base },
        }) as Promise<SupervisorResult<AgentPrimeBody>>,
        'gc supervisor agent prime response was empty',
      );
    },
    sling(cityName, body) {
      return unwrapSupervisorResult<SlingResponse>(
        postV0CityByCityNameSling({
          client,
          path: { cityName },
          headers: GC_MUTATION_HEADERS,
          body,
        }) as Promise<SupervisorResult<SlingResponse>>,
        'gc supervisor sling response was empty',
      );
    },
    listMail(cityName, query) {
      return unwrapSupervisorResult<MailListBody>(
        getV0CityByCityNameMail({
          client,
          path: { cityName },
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<MailListBody>>,
        'gc supervisor mail response was empty',
      );
    },
    formulaFeed(cityName, query) {
      return unwrapSupervisorResult<FormulaFeedBody>(
        getV0CityByCityNameFormulasFeed({
          client,
          path: { cityName },
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<FormulaFeedBody>>,
        'gc supervisor formula feed response was empty',
      );
    },
    sendMail(cityName, body) {
      return unwrapSupervisorResult<Message>(
        postSupervisorMail({
          client,
          path: { cityName },
          headers: GC_MUTATION_HEADERS,
          body,
        }) as Promise<SupervisorResult<Message>>,
        'gc supervisor mail send response was empty',
      );
    },
    mailThread(cityName, threadId) {
      return unwrapSupervisorResult<MailListBody>(
        getV0CityByCityNameMailThreadById({
          client,
          path: { cityName, id: threadId },
        }) as Promise<SupervisorResult<MailListBody>>,
        'gc supervisor mail thread response was empty',
      );
    },
    markMailRead(cityName, id, query) {
      return unwrapSupervisorResult<OkResponseBody>(
        postV0CityByCityNameMailByIdRead({
          client,
          path: { cityName, id },
          headers: GC_MUTATION_HEADERS,
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<OkResponseBody>>,
        'gc supervisor mail mark-read response was empty',
      );
    },
    markMailUnread(cityName, id, query) {
      return unwrapSupervisorResult<OkResponseBody>(
        postV0CityByCityNameMailByIdMarkUnread({
          client,
          path: { cityName, id },
          headers: GC_MUTATION_HEADERS,
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<OkResponseBody>>,
        'gc supervisor mail mark-unread response was empty',
      );
    },
    archiveMail(cityName, id, query) {
      return unwrapSupervisorResult<OkResponseBody>(
        postV0CityByCityNameMailByIdArchive({
          client,
          path: { cityName, id },
          headers: GC_MUTATION_HEADERS,
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<OkResponseBody>>,
        'gc supervisor mail archive response was empty',
      );
    },
    replyMail(cityName, id, body, query) {
      return unwrapSupervisorResult<Message>(
        postSupervisorMailReply({
          client,
          path: { cityName, id },
          headers: GC_MUTATION_HEADERS,
          body,
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<Message>>,
        'gc supervisor mail reply response was empty',
      );
    },
    cityEventStreamUrl(cityName, afterSeq) {
      return supervisorUrl(
        baseUrl,
        `/v0/city/${encodeURIComponent(cityName)}/events/stream`,
        afterSeq === undefined ? undefined : { after_seq: afterSeq },
      );
    },
    sessionStreamUrl(cityName, sessionId, after) {
      return supervisorUrl(
        baseUrl,
        `/v0/city/${encodeURIComponent(cityName)}/session/${encodeURIComponent(sessionId)}/stream`,
        after === undefined ? undefined : { after },
      );
    },
    listSessions(cityName) {
      return unwrapSupervisorResult<ListBodySessionResponse>(
        getV0CityByCityNameSessions({
          client,
          path: { cityName },
        }) as Promise<SupervisorResult<ListBodySessionResponse>>,
        'gc supervisor sessions response was empty',
      );
    },
    sessionPending(cityName, sessionId) {
      return unwrapSupervisorResult<SessionPendingResponse>(
        getV0CityByCityNameSessionByIdPending({
          client,
          path: { cityName, id: sessionId },
        }) as Promise<SupervisorResult<SessionPendingResponse>>,
        'gc supervisor session pending response was empty',
      );
    },
    respondSession(cityName, sessionId, body) {
      return unwrapSupervisorResult<RespondSessionResponse>(
        postSupervisorSessionRespond({
          client,
          path: { cityName, id: sessionId },
          headers: GC_MUTATION_HEADERS,
          body,
        }) as Promise<SupervisorResult<RespondSessionResponse>>,
        'gc supervisor session respond response was empty',
      );
    },
    sessionTranscript(cityName, sessionId) {
      return unwrapSupervisorResult<SessionTranscriptGetResponse>(
        getV0CityByCityNameSessionByIdTranscript({
          client,
          path: { cityName, id: sessionId },
          query: { format: 'conversation' },
        }) as Promise<SupervisorResult<SessionTranscriptGetResponse>>,
        'gc supervisor transcript response was empty',
      );
    },
    workflowRun(cityName, workflowId, query) {
      return unwrapSupervisorResult<WorkflowSnapshotResponse>(
        getV0CityByCityNameWorkflowByWorkflowId({
          client,
          path: { cityName, workflow_id: workflowId },
          ...(query === undefined ? {} : { query }),
        }) as Promise<SupervisorResult<WorkflowSnapshotResponse>>,
        'gc supervisor workflow response was empty',
      );
    },
    formulaDetail(cityName, name, query) {
      return unwrapSupervisorResult<FormulaDetailResponse>(
        getV0CityByCityNameFormulasByName({
          client,
          path: { cityName, name },
          query,
        }) as Promise<SupervisorResult<FormulaDetailResponse>>,
        'gc supervisor formula detail response was empty',
      );
    },
    mutationHeaders() {
      return { ...GC_MUTATION_HEADERS };
    },
  };
}

export function supervisorApi(): SupervisorApi {
  if (testSupervisorApi !== null) return testSupervisorApi;
  defaultSupervisorApi ??= createSupervisorApi();
  return defaultSupervisorApi;
}

export function setSupervisorApiForTests(api: SupervisorApi): void {
  testSupervisorApi = api;
}

export function resetSupervisorApiForTests(): void {
  testSupervisorApi = null;
  defaultSupervisorApi = null;
}

function resolveSupervisorBaseUrl(): string {
  const configured = import.meta.env.VITE_GC_SUPERVISOR_URL;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }
  return SUPERVISOR_PROXY_BASE_URL;
}

function resolveClientBaseUrl(baseUrl: string): string {
  if (!baseUrl.startsWith('/')) return baseUrl;
  const origin = globalThis.location?.origin;
  if (typeof origin !== 'string' || origin.length === 0 || origin === 'null') {
    return baseUrl;
  }
  return new URL(baseUrl, origin).toString().replace(/\/$/, '');
}

function supervisorUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string>,
): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const search = new URLSearchParams(query).toString();
  const suffix = search.length > 0 ? `${path}?${search}` : path;
  if (normalizedBase.startsWith('/')) return `${normalizedBase}${suffix}`;
  return new URL(suffix, `${normalizedBase}/`).toString();
}

function splitAgentAlias(agentAlias: string): { base: string } | { dir: string; base: string } {
  const parts = agentAlias.trim().split('/');
  if (parts.length === 1) {
    const base = parts[0];
    if (base !== undefined && base !== '') return { base };
  }
  if (parts.length === 2) {
    const dir = parts[0];
    const base = parts[1];
    if (dir !== undefined && dir !== '' && base !== undefined && base !== '') {
      return { dir, base };
    }
  }
  throw new Error(`invalid agent alias: ${agentAlias}`);
}

async function unwrapSupervisorResult<T>(
  promise: Promise<SupervisorResult<T>>,
  emptyMessage: string,
): Promise<T> {
  let result: SupervisorResult<T>;
  try {
    result = await promise;
  } catch (err) {
    throw normalizeThrownSupervisorError(err);
  }

  const { response } = result;
  if (response === undefined) {
    throw new SupervisorApiError(undefined, messageFromUnknown(result.error), undefined);
  }
  if (!response.ok || result.error !== undefined) {
    throw new SupervisorApiError(
      response.status,
      messageFromUnknown(result.error, response.statusText),
      response.headers.get('x-gc-request-id') ?? undefined,
    );
  }
  const data = result.data;
  if (data === undefined) {
    throw new SupervisorApiError(
      response.status,
      emptyMessage,
      response.headers.get('x-gc-request-id') ?? undefined,
    );
  }
  return data;
}

function normalizeThrownSupervisorError(err: unknown): SupervisorApiError {
  if (err instanceof SupervisorApiError) return err;
  return new SupervisorApiError(undefined, messageFromUnknown(err), undefined);
}

function messageFromUnknown(value: unknown, fallback = 'gc supervisor request failed'): string {
  if (isGeneratedSchemaValidationError(value)) return SUPERVISOR_SCHEMA_VALIDATION_MESSAGE;
  if (typeof value === 'string' && value.trim().length > 0) {
    return sanitizeSupervisorMessage(value);
  }
  if (value instanceof Error && value.message.trim().length > 0) {
    return sanitizeSupervisorMessage(value.message);
  }
  if (isRecord(value)) {
    for (const key of ['error', 'message', 'detail']) {
      const field = value[key];
      if (typeof field === 'string' && field.trim().length > 0) {
        return sanitizeSupervisorMessage(field);
      }
    }
  }
  return fallback;
}

function sanitizeSupervisorMessage(message: string): string {
  const trimmed = message.trim();
  return isGeneratedSchemaValidationMessage(trimmed)
    ? SUPERVISOR_SCHEMA_VALIDATION_MESSAGE
    : trimmed;
}

function isGeneratedSchemaValidationError(value: unknown): boolean {
  if (value instanceof Error) {
    return value.name === 'ZodError' || isGeneratedSchemaValidationMessage(value.message);
  }
  return isZodIssueList(value);
}

function isGeneratedSchemaValidationMessage(message: string): boolean {
  if (!message.startsWith('[') && !message.startsWith('{')) return false;
  try {
    return isZodIssueList(JSON.parse(message));
  } catch {
    return false;
  }
}

function isZodIssueList(value: unknown): boolean {
  const issues = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.issues)
      ? value.issues
      : null;
  return issues !== null &&
    issues.length > 0 &&
    issues.every((issue) =>
      isRecord(issue) &&
      typeof issue.code === 'string' &&
      Array.isArray(issue.path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
