import type {
  EntityLinkView,
  GcBead,
  GcSession,
} from 'gas-city-dashboard-shared';
import {
  buildLinkView,
  buildRelationIndex,
  parseRef,
} from 'gas-city-dashboard-shared';
import { getActiveCity } from '../api/cityBase';
import type {
  Bead,
  ListBodyBead,
  ListBodySessionResponse,
  SessionResponse,
} from '../generated/gc-supervisor-client/types.gen';
import { supervisorApi } from './client';

const LINKS_FETCH_LIMIT = 5_000;

export async function loadSupervisorEntityLinks(ref: string): Promise<EntityLinkView> {
  const parsed = parseRef(ref);
  if (!parsed.ok) throw new Error(parsed.error);

  const cityName = activeCityOrThrow('load supervisor entity links');
  const supervisorFetchedAt = new Date().toISOString();
  const beadList = await supervisorApi().listBeads(cityName, { limit: LINKS_FETCH_LIMIT });
  const beads = normalizeBeads(beadList.items ?? []);
  let partial = listIsPartial(beadList);
  if (typeof beadList.total === 'number' && beadList.total > beads.length) {
    partial = true;
  }

  let sessions: GcSession[] = [];
  try {
    const sessionList = await supervisorApi().listSessions(cityName);
    sessions = normalizeSessions(sessionList);
    partial ||= sessionListIsPartial(sessionList);
  } catch {
    partial = true;
  }

  const index = buildRelationIndex(beads, sessions, cityName);
  return buildLinkView(index, parsed, {
    partial,
    supervisorFetchedAt,
    githubFetchedAt: null,
  });
}

function normalizeBeads(beads: readonly Bead[]): GcBead[] {
  return beads.map(normalizeBead);
}

function normalizeBead(bead: Bead): GcBead {
  const normalized: GcBead = {
    id: bead.id,
    title: bead.title,
    status: bead.status,
    issue_type: bead.issue_type,
    priority: bead.priority ?? null,
    created_at: bead.created_at,
  };
  if (bead.description !== undefined) normalized.description = bead.description;
  if (bead.assignee !== undefined) normalized.assignee = bead.assignee;
  if (Array.isArray(bead.labels)) normalized.labels = bead.labels;
  if (bead.metadata !== undefined) normalized.metadata = bead.metadata;
  if (bead.ref !== undefined) normalized.ref = bead.ref;
  if (bead.parent !== undefined) normalized.parent = bead.parent;
  if (bead.from !== undefined) normalized.from = bead.from;
  if (bead.ephemeral !== undefined) normalized.ephemeral = bead.ephemeral;
  if (bead.needs !== undefined) normalized.needs = bead.needs;
  if (bead.dependencies !== undefined) normalized.dependencies = bead.dependencies;
  if (bead.updated_at !== undefined) normalized.updated_at = bead.updated_at;
  return normalized;
}

function normalizeSessions(list: ListBodySessionResponse): GcSession[] {
  return (list.items ?? []).map(normalizeSession);
}

function normalizeSession(session: SessionResponse): GcSession {
  const normalized: GcSession = {
    id: session.id,
    template: session.template,
    session_name: session.session_name,
    title: session.title,
    state: session.state,
    created_at: session.created_at,
    attached: session.attached,
    running: session.running,
    provider: session.provider,
  };
  if (session.alias !== undefined) normalized.alias = session.alias;
  if (session.reason !== undefined) normalized.reason = session.reason;
  if (session.display_name !== undefined) normalized.display_name = session.display_name;
  if (session.last_active !== undefined) normalized.last_active = session.last_active;
  if (session.rig !== undefined) normalized.rig = session.rig;
  if (session.pool !== undefined) normalized.pool = session.pool;
  if (session.agent_kind !== undefined) normalized.agent_kind = session.agent_kind;
  if (session.model !== undefined) normalized.model = session.model;
  if (session.context_pct !== undefined) normalized.context_pct = session.context_pct;
  if (session.context_window !== undefined) normalized.context_window = session.context_window;
  if (session.activity !== undefined) normalized.activity = session.activity;
  return normalized;
}

function listIsPartial(list: ListBodyBead): boolean {
  return list.partial === true || (list.partial_errors?.length ?? 0) > 0;
}

function sessionListIsPartial(list: ListBodySessionResponse): boolean {
  return list.partial === true || (list.partial_errors?.length ?? 0) > 0;
}

function activeCityOrThrow(operation: string): string {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error(`${operation} called before an active city was resolved`);
  }
  return cityName;
}
