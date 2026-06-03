import type {
  GcBead,
  GcBeadList,
  GcFormulaDetail,
  GcRunSnapshot,
  GcSessionList,
  SlingResponse,
  TranscriptTurn,
} from 'gas-city-dashboard-shared';
import { z } from 'zod';
import type {
  AgentResponse,
  Bead,
  FormulaDetailResponse,
  FormulaFeedBody,
  ListBodyAgentResponse,
  ListBodyBead,
  ListBodyRigResponse,
  ListBodySessionResponse,
  SessionTranscriptGetResponse,
  StatusBody,
  SupervisorCitiesOutputBody,
  WorkflowSnapshotResponse,
} from './generated/gc-supervisor-client/types.gen.js';

type RawSupervisorSchema = {
  AgentResponse: AgentResponse;
  Bead: Bead;
  FormulaDetailResponse: FormulaDetailResponse;
  FormulaFeedBody: FormulaFeedBody;
  ListBodyAgentResponse: ListBodyAgentResponse;
  ListBodyBead: ListBodyBead;
  ListBodyRigResponse: ListBodyRigResponse;
  ListBodySessionResponse: ListBodySessionResponse;
  SessionTranscriptGetResponse: SessionTranscriptGetResponse;
  StatusBody: StatusBody;
  SupervisorCitiesOutputBody: SupervisorCitiesOutputBody;
  WorkflowSnapshotResponse: WorkflowSnapshotResponse;
};

/**
 * Decoder-edge type for the supervisor's session-transcript response.
 * Intentionally local to the backend — this is the raw decoded shape,
 * NOT a wire-shape that crosses the dashboard's own API boundary. Backend
 * composed routes still use it while their supervisor-backed read surfaces
 * are migrated. Do not move to shared/.
 */
export interface GcTranscriptResponse {
  id?: string;
  template?: string;
  provider?: string;
  format?: string;
  turns: TranscriptTurn[];
}

export type GcDecoder<RawValue, DecodedValue> = (value: RawValue) => DecodedValue;

type GcWorkflowSnapshot = Omit<GcRunSnapshot, 'run_id'> & {
  workflow_id: string;
};

const StringRecordSchema = z.record(z.string(), z.string());

// 6bv7 F10: provider, running, session_name, title are declared REQUIRED in
// OpenAPI SessionResponse and present in 73/73 live sessions. Tighten here
// so a future supervisor that drops one of them fails at the decoder edge
// instead of leaking undefined into UI code that no longer guards for it.
const SessionSchema = z.object({
  id: z.string(),
  template: z.string(),
  state: z.string(),
  created_at: z.string(),
  attached: z.boolean(),
  provider: z.string(),
  running: z.boolean(),
  session_name: z.string(),
  title: z.string(),
  alias: z.string().optional(),
  reason: z.string().optional(),
  display_name: z.string().optional(),
  last_active: z.string().optional(),
  rig: z.string().optional(),
  pool: z.string().optional(),
  agent_kind: z.string().optional(),
  model: z.string().optional(),
  activity: z.string().optional(),
  context_pct: z.number().finite().optional(),
  context_window: z.number().finite().optional(),
}).passthrough();

// 6bv7 F15: structured dependency rows surfaced under OpenAPI Bead.dependencies.
const BeadDepSchema = z.object({
  depends_on_id: z.string(),
  issue_id: z.string(),
  type: z.string(),
}).passthrough();

const BeadSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  issue_type: z.string(),
  // The supervisor's OpenAPI spec declares priority optional and in practice
  // sends `null` for non-engineering beads (messages, sessions, …). Accept
  // both null and missing, then collapse `undefined → null` at the decoder
  // edge so the typed interior (`GcBead.priority: number | null`) never sees
  // an `undefined` it isn't declared to handle. Per CLAUDE.md: "Keep
  // serialization/deserialization at the edges". (Merged from PR #34's
  // upstream priority-null fix; .transform() is this wave's Phase 4
  // tightening.)
  priority: z.number().finite().nullish().transform((v) => v ?? null),
  created_at: z.string(),
  description: z.string().optional(),
  assignee: z.string().optional(),
  ref: z.string().optional(),
  labels: z.array(z.string()).optional(),
  // 6bv7 F11: OpenAPI Bead.metadata is declared as `{[key: string]: string}`.
  // Tighten to StringRecordSchema so consumers can drop the defensive
  // `typeof === 'string'` checks that were guarding against the prior
  // UnknownRecordSchema laundering arbitrary value types through the SSOT.
  metadata: StringRecordSchema.optional(),
  // 6bv7 F15: parent/from/ephemeral/needs/dependencies are emitted in live
  // data and declared in the OpenAPI Bead schema; surfacing them eliminates
  // the `as any` casts callers were using to read them off passthrough().
  parent: z.string().optional(),
  from: z.string().optional(),
  ephemeral: z.boolean().optional(),
  needs: z.array(z.string()).nullable().optional(),
  dependencies: z.array(BeadDepSchema).nullable().optional(),
}).passthrough();

// Per-rig wire shape from `GET /v0/city/{name}/rigs`.
// gascity-dashboard-19w.
const RigSchema = z.object({
  agent_count: z.number().finite(),
  name: z.string(),
  path: z.string(),
  running_count: z.number().finite(),
  suspended: z.boolean(),
}).passthrough();

// Host-side city descriptor. Retains the untrusted host `path` because the
// per-city runtime registry needs it; never serialize this shape to the
// browser.
const SupervisorCitySchema = z.object({
  name: z.string(),
  path: z.string(),
  running: z.boolean(),
}).passthrough();

/** Host-side city descriptor including the untrusted supervisor host path. */
export interface SupervisorCity {
  name: string;
  path: string;
  running: boolean;
}

// Per-agent wire shape from `GET /v0/city/{name}/agents` and
// `GET /v0/city/{name}/agent/{base}`. Mirrors the supervisor's
// AgentResponse schema (backend/src/generated/gc-supervisor-client/types.gen.ts).
// gascity-dashboard-ay6.
//
// Required fields per OpenAPI: name, available, running, suspended,
// state. Embedded `session` is the supervisor's `SessionInfo` shape —
// only `attached` + `name` are required there; `last_activity` is
// optional. Absent `session` means the agent is configured but does not
// currently have a running supervisor session (the canonical case the
// session-derived path under-counted).
const AgentSessionSchema = z.object({
  name: z.string(),
  attached: z.boolean(),
  last_activity: z.string().optional(),
}).passthrough();

const AgentSchema = z.object({
  name: z.string(),
  available: z.boolean(),
  running: z.boolean(),
  suspended: z.boolean(),
  state: z.string(),
  display_name: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  pool: z.string().optional(),
  rig: z.string().optional(),
  activity: z.string().optional(),
  context_pct: z.number().finite().optional(),
  context_window: z.number().finite().optional(),
  unavailable_reason: z.string().optional(),
  session: AgentSessionSchema.optional(),
}).passthrough();

const RunBeadSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  kind: z.string(),
  step_ref: z.string().optional(),
  attempt: z.number().finite().optional(),
  logical_bead_id: z.string().optional(),
  scope_ref: z.string().optional(),
  assignee: z.string().optional(),
  metadata: StringRecordSchema,
}).passthrough();

const RunDepSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string().optional(),
}).passthrough();

// 6bv7 F19: OpenAPI FormulaPreviewNodeResponse declares title + kind REQUIRED.
const FormulaPreviewNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
}).passthrough();

const FormulaPreviewEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string().optional(),
}).passthrough();

// Supervisor's OpenAPI declares LogicalNode and ScopeGroup as
// `{additionalProperties: false, type: 'object'}` — always-empty objects.
// Shared types them as `Record<string, never>[]`; mirroring with an empty
// Zod object preserves the SSOT contract. (Previously used
// UnknownRecordSchema, which accepted any keys and laundered the
// mismatch via the t5l6 decoder cast.)
//
// Intentionally no .passthrough(): the rest of this file's schemas allow
// passthrough at the top level so the decoder remains forward-compatible
// with unknown supervisor fields, but THIS schema must strip unknown keys
// to remain a faithful surface for Record<string, never>. Adding
// .passthrough() here would widen the element type back to
// {[k: string]: unknown}, defeating the SSOT alignment.
const EmptyObjectSchema = z.object({});

const RunSnapshotBaseSchema = z.object({
  root_bead_id: z.string(),
  root_store_ref: z.string(),
  resolved_root_store: z.string(),
  scope_kind: z.string(),
  scope_ref: z.string(),
  snapshot_version: z.number().finite(),
  snapshot_event_seq: z.number().finite().nullable().optional(),
  partial: z.boolean(),
  stores_scanned: z.array(z.string()).nullable(),
  beads: z.array(RunBeadSchema).nullable(),
  deps: z.array(RunDepSchema).nullable(),
  logical_nodes: z.array(EmptyObjectSchema).nullable(),
  logical_edges: z.array(RunDepSchema).nullable(),
  scope_groups: z.array(EmptyObjectSchema).nullable(),
}).passthrough();

const WorkflowSnapshotSchema = RunSnapshotBaseSchema.extend({
  workflow_id: z.string(),
}).passthrough();

const FormulaDetailSchema = z.object({
  name: z.string(),
  preview: z.object({
    nodes: z.array(FormulaPreviewNodeSchema).optional(),
    edges: z.array(FormulaPreviewEdgeSchema).optional(),
  }).passthrough().optional(),
  // izgc F5/F6: OpenAPI declares steps/deps as `T[] | null` (required +
  // nullable). Accept null and missing, then collapse to undefined so the
  // typed interior (GcFormulaDetail.steps?: T[]) matches Zod output exactly
  // — bypasses the t5l6 cast-laundering bug without pulling it into scope.
  steps: z.array(FormulaPreviewNodeSchema).nullish().transform((v) => v ?? undefined),
  deps: z.array(FormulaPreviewEdgeSchema).nullish().transform((v) => v ?? undefined),
}).passthrough();

const TranscriptTurnSchema = z.object({
  role: z.string(),
  text: z.string(),
}).passthrough();

const TranscriptResponseSchema = z.object({
  id: z.string().optional(),
  template: z.string().optional(),
  provider: z.string().optional(),
  format: z.string().optional(),
  // izgc F2: OpenAPI declares turns?: T[] | null (optional AND nullable).
  // Live raw-format responses already omit the key. Normalize null/missing
  // to [] at the edge so GcTranscriptResponse.turns stays non-null.
  turns: z.array(TranscriptTurnSchema).nullish().transform((v) => v ?? []),
}).passthrough();

// izgc F3: every ListBody* envelope in the supervisor's OpenAPI declares
// `items: T[] | null` for partial/degraded responses, correlated with
// `partial: true` and `partial_errors`. Build the list-decoder fields once
// so the four list shapes stay consistent: items collapses null → [], but
// the partial signal survives on the shared interface so consumers can
// surface degradation. Per CLAUDE.md "Don't Swallow Errors" + "Keep
// serialization/deserialization at the edges".
function listItemsField<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.array(itemSchema).nullish().transform((v) => v ?? []);
}
// The supervisor's OpenAPI declares `partial` as optional on ListBodyBead and
// ListBodySessionResponse — `PartialField` mirrors that contract.
const PartialField = z.boolean().optional();
const PartialErrorsField = z.array(z.string())
  .nullish()
  .transform((v) => (v ?? undefined));

export const gcSupervisorDecoders = {
  listSessions(value: RawSupervisorSchema['ListBodySessionResponse']): GcSessionList {
    return decodeSupervisorPayload(
      z.object({
        items: listItemsField(SessionSchema),
        // 6bv7 F14: OpenAPI ListBodySessionResponse declares total required.
        total: z.number().finite(),
        partial: PartialField,
        partial_errors: PartialErrorsField,
      }).passthrough(),
      value,
      'listSessions',
    );
  },

  listRigs(value: RawSupervisorSchema['ListBodyRigResponse']): ListBodyRigResponse {
    return decodeSupervisorPayload(
      z.object({
        items: listItemsField(RigSchema),
        total: z.number().finite(),
        partial: PartialField,
        partial_errors: PartialErrorsField,
      }).passthrough(),
      value,
      'listRigs',
    );
  },

  // Host-side city registry decode that RETAINS the untrusted host `path`.
  // The per-city runtime registry needs the path to build each city's
  // CLI-shelling routes; it is kept host-side and NEVER serialized to the
  // browser. Browser city discovery uses the generated frontend supervisor
  // client directly.
  listSupervisorCities(
    value: RawSupervisorSchema['SupervisorCitiesOutputBody'],
  ): readonly SupervisorCity[] {
    const decoded = decodeSupervisorPayload<{
      items: SupervisorCity[];
      total: number;
    }>(
      z.object({
        items: listItemsField(SupervisorCitySchema),
        total: z.number().finite(),
      }).passthrough(),
      value,
      'listSupervisorCities',
    );
    return decoded.items;
  },

  listAgents(value: RawSupervisorSchema['ListBodyAgentResponse']): ListBodyAgentResponse {
    return decodeSupervisorPayload(
      z.object({
        items: listItemsField(AgentSchema),
        total: z.number().finite(),
        partial: PartialField,
        partial_errors: PartialErrorsField,
      }).passthrough(),
      value,
      'listAgents',
    );
  },

  getAgent(value: RawSupervisorSchema['AgentResponse']): AgentResponse {
    return decodeSupervisorPayload(AgentSchema, value, 'getAgent');
  },

  getBead(value: RawSupervisorSchema['Bead']): GcBead {
    return decodeSupervisorPayload(BeadSchema, value, 'getBead');
  },

  listBeads(value: RawSupervisorSchema['ListBodyBead']): GcBeadList {
    return decodeSupervisorPayload(
      z.object({
        items: listItemsField(BeadSchema),
        // 6bv7 F14: OpenAPI ListBodyBead declares total required.
        total: z.number().finite(),
        partial: PartialField,
        partial_errors: PartialErrorsField,
      }).passthrough(),
      value,
      'listBeads',
    );
  },

  getRun(value: RawSupervisorSchema['WorkflowSnapshotResponse']): GcRunSnapshot {
    const wire = decodeSupervisorPayload<GcWorkflowSnapshot>(
      WorkflowSnapshotSchema,
      value,
      'getRun',
    );
    const {
      workflow_id: workflowId,
      snapshot_event_seq: snapshotEventSeq,
      ...rest
    } = wire;
    const snapshot: GcRunSnapshot = {
      ...rest,
      run_id: workflowId,
    };
    if (snapshotEventSeq !== undefined) {
      snapshot.snapshot_event_seq = snapshotEventSeq;
    }
    return snapshot;
  },

  listFormulaRuns(value: RawSupervisorSchema['FormulaFeedBody']): FormulaFeedBody {
    return value;
  },

  getFormulaDetail(value: RawSupervisorSchema['FormulaDetailResponse']): GcFormulaDetail {
    return decodeSupervisorPayload(FormulaDetailSchema, value, 'getFormulaDetail');
  },

  fetchTranscript(value: RawSupervisorSchema['SessionTranscriptGetResponse']): GcTranscriptResponse {
    return decodeSupervisorPayload(
      TranscriptResponseSchema,
      value,
      'fetchTranscript',
    );
  },

  getStatus(value: RawSupervisorSchema['StatusBody']): StatusBody {
    return value;
  },

  // gascity-dashboard sling wire-field mapping. #61 renamed
  // `SlingResponse.workflow_id` → `run_id`, but the gc supervisor still
  // emits the JSON field `workflow_id` on the /sling wire. Read the wire
  // field explicitly and map it onto the renamed property so the routed
  // run id is NOT silently dropped on the cast at the write edge.
  decodeSling(value: unknown): SlingResponse {
    const wire = decodeSupervisorPayload<SlingWire>(
      SlingResponseSchema,
      value,
      'sling',
    );
    const { workflow_id: workflowId, ...rest } = wire;
    return workflowId !== undefined ? { ...rest, run_id: workflowId } : rest;
  },
} as const;

interface SlingWire {
  root_bead_id?: string;
  bead?: string;
  workflow_id?: string;
  target?: string;
  status?: string;
}

const SlingResponseSchema = z.object({
  root_bead_id: z.string().optional(),
  bead: z.string().optional(),
  workflow_id: z.string().optional(),
  target: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

// gascity-dashboard-t5l6: `z.ZodType<SchemaOutputFor<NoInfer<Decoded>>>`
// (not the bare `z.ZodType`) is load-bearing. It ties the Zod schema's
// output to the caller-declared `Decoded` so tsc rejects schemas whose
// parsed shape diverges from the shared SSOT type — see SchemaOutputFor
// + NoInfer below for the mechanics. The previous `as Decoded` cast
// laundered any schema into any return type, silently defeating the
// wire-shape contract. Verified by
// backend/test/gc-supervisor-decoders-types.test.ts.
function decodeSupervisorPayload<Decoded>(
  schema: z.ZodType<SchemaOutputFor<NoInfer<Decoded>>>,
  value: unknown,
  payload: string,
): Decoded {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidSupervisorPayload(payload, parsed.error);
  }
  // `parsed.data` is `SchemaOutputFor<Decoded>` — structurally identical
  // to `Decoded` at runtime but TS-noisier on optional fields (see
  // SchemaOutputFor comment). Narrow, documented cast — not the
  // unconstrained `as Decoded` laundering removed by t5l6.
  return parsed.data as Decoded;
}

export function invalidGeneratedSupervisorPayload(
  payload: string,
  error: unknown,
): Error | null {
  const zodError = zodErrorFromUnknown(error);
  if (zodError === null) return null;
  return invalidSupervisorPayload(payload, zodError);
}

function zodErrorFromUnknown(error: unknown): z.ZodError | null {
  if (error instanceof z.ZodError) return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray((error as { issues?: unknown }).issues)
  ) {
    return error as z.ZodError;
  }
  return null;
}

// Maps a shared SSOT type into the structural shape a Zod schema is
// expected to emit. For every property:
//   - required `foo: T`  → required `foo: SchemaOutputFor<T>`
//   - optional `foo?: T` → optional `foo?: SchemaOutputFor<T> | undefined`
// (the second form is what Zod's `.optional()` produces under the
// project's `exactOptionalPropertyTypes: true` — Zod's runtime emission
// matches `foo?: T` exactly, but its TS-level output type is noisier).
// Recurses through array element types so nested shared interfaces (e.g.
// `GcBeadList.items: GcBead[]`) are loosened consistently. Paired with
// `NoInfer<Decoded>` in `decodeSupervisorPayload` so `Decoded` binds from
// the caller's return-type context, not from the schema parameter.
type SchemaOutputFor<T> =
  T extends readonly (infer U)[]
    ? SchemaOutputFor<U>[]
    : T extends object
      ?
          & { [K in RequiredKeysOf<T>]: SchemaOutputFor<T[K]> }
          & { [K in OptionalKeysOf<T>]?: SchemaOutputFor<T[K]> | undefined }
      : T;

// The `{}` here is the canonical structural-equivalence trick for
// detecting optional vs required keys (an empty object satisfies a Pick
// of an optional field, but never a required one). Disabling the
// no-empty-object-type rule for these two lines is the intent per
// the rule's own documented remediation.
type RequiredKeysOf<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type OptionalKeysOf<T> = {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

function invalidSupervisorPayload(payload: string, error: z.ZodError): Error {
  const issue = error.issues[0];
  const path = issue ? zodPath(issue.path) : 'payload';
  const expected = issue ? zodExpected(issue) : 'valid';
  return new Error(
    `invalid gc supervisor ${payload} payload: ${path} must be ${expected}`,
  );
}

function zodPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return 'payload';
  return `payload${path.map((part) => {
    if (typeof part === 'number') return `[${part}]`;
    // The path segment is a supervisor-controlled key (e.g. a metadata
    // key after 6bv7 F11). Strip CR/LF so a malicious or buggy
    // supervisor that emits a key like `"evil\n[component] forged log"`
    // cannot forge a line into the dashboard's logs when this error
    // surfaces through logWarn (route-errors / snapshot/cache).
    return `.${String(part).replace(/[\r\n]/g, '_')}`;
  }).join('')}`;
}

type ZodIssue = z.ZodError['issues'][number];

function zodExpected(issue: ZodIssue): string {
  if (issue.code === 'invalid_type' && 'expected' in issue) {
    if ('input' in issue && issue.input === undefined) return 'present';
    return String(issue.expected);
  }
  // Fallback for non-invalid_type issues (invalid_value, invalid_format,
  // too_small, etc.). Zod's built-in `issue.message` may embed the received
  // value (e.g. invalid_value in Zod 4 includes the input). Even though
  // toWireInternal500 strips the message to details.name before serving, the
  // server-side log line still carries supervisor data through this path —
  // return a fixed shape keyed on the discriminator code instead so the log
  // is value-free by construction.
  return `valid (${issue.code})`;
}
