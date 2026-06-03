import type {
  GcRunBead,
} from '../run-snapshot.js';
import type { GcSession } from '../gc-client-types.js';
import type {
  RunNodeStatus,
  RunSessionLink,
} from '../run-detail.js';
import { SESSION_ID_RE } from '../session-id.js';
import { meta, nonEmpty } from './bead-fields.js';

export interface RunSessionIndex {
  byId: Map<string, GcSession>;
  byName: Map<string, GcSession>;
  byTemplate: Map<string, GcSession[]>;
}

export interface RunSessionLinkContext {
  sessionIndex?: RunSessionIndex;
  scopeRef?: string;
}

export function buildRunSessionIndex(
  sessions: readonly GcSession[],
): RunSessionIndex {
  const byId = new Map<string, GcSession>();
  const byName = new Map<string, GcSession>();
  const byTemplate = new Map<string, GcSession[]>();

  for (const session of sessions) {
    remember(byId, session.id, session);
    remember(byName, session.alias, session);
    remember(byName, session.title, session);
    remember(byName, session.session_name, session);
    const template = nonEmpty(session.template);
    if (template) byTemplate.set(template, [...(byTemplate.get(template) ?? []), session]);
  }

  return { byId, byName, byTemplate };
}

export function runSessionLinkFor(
  bead: GcRunBead,
  status: RunNodeStatus,
  context: RunSessionLinkContext = {},
): RunSessionLink | undefined {
  if (status === 'pending' || status === 'ready') return undefined;
  const assignee = nonEmpty(bead.assignee);
  const sessionId =
    meta(bead, 'session_id') ??
    meta(bead, 'gc.session_id') ??
    meta(bead, 'gc.sessionId') ??
    supervisorSessionIdFrom(assignee) ??
    assignee;
  const sessionName =
    meta(bead, 'session_name') ??
    meta(bead, 'gc.session_name') ??
    meta(bead, 'gc.sessionName') ??
    assignee ??
    sessionId;
  if (!sessionId && !sessionName) return undefined;
  const rawLink: RunSessionLink = {
    sessionId: sessionId ?? sessionName ?? '',
    sessionName: sessionName ?? sessionId ?? '',
    assignee: assignee ?? sessionName ?? sessionId ?? '',
  };
  return resolveRunSessionLink(rawLink, context.sessionIndex);
}

function supervisorSessionIdFrom(value: string | undefined): string | undefined {
  const clean = nonEmpty(value);
  if (!clean) return undefined;
  if (SESSION_ID_RE.test(clean)) return clean;
  const suffix = clean.match(/(?:^|[-_/])((?:gc|td|th|[a-z]{4})-[a-z0-9-]{1,32})$/)?.[1];
  if (!suffix || !SESSION_ID_RE.test(suffix)) return undefined;
  return suffix;
}

function resolveRunSessionLink(
  rawLink: RunSessionLink,
  sessionIndex: RunSessionIndex | undefined,
): RunSessionLink {
  if (!sessionIndex) return rawLink;
  const session = resolveRunSessionSummary(rawLink, sessionIndex);
  if (!session) return rawLink;
  return linkForSession(session, rawLink);
}

function resolveRunSessionSummary(
  link: RunSessionLink,
  sessionIndex: RunSessionIndex,
): GcSession | null {
  for (const candidate of [link.sessionId, link.sessionName, link.assignee]) {
    const key = nonEmpty(candidate);
    if (!key) continue;
    const exact =
      sessionIndex.byId.get(key) ??
      sessionIndex.byName.get(key) ??
      uniquePreferredSession(sessionIndex.byTemplate.get(key) ?? []);
    if (exact) return exact;
  }
  return null;
}

function linkForSession(
  session: GcSession,
  rawLink: RunSessionLink,
): RunSessionLink {
  return {
    sessionId: session.id,
    sessionName:
      nonEmpty(session.alias) ??
      nonEmpty(session.title) ??
      nonEmpty(session.session_name) ??
      nonEmpty(session.template) ??
      rawLink.sessionName,
    assignee:
      rawLink.assignee ||
      nonEmpty(session.template) ||
      nonEmpty(session.alias) ||
      nonEmpty(session.title) ||
      nonEmpty(session.session_name) ||
      session.id,
  };
}

function uniquePreferredSession(sessions: readonly GcSession[]): GcSession | null {
  if (sessions.length === 0) return null;
  const active = sessions.filter((session) => session.state === 'active' || session.running === true);
  if (active.length === 1) return active[0] ?? null;
  if (sessions.length === 1) return sessions[0] ?? null;
  return null;
}

function remember(
  store: Map<string, GcSession>,
  key: string | undefined,
  session: GcSession,
): void {
  const clean = nonEmpty(key);
  if (!clean || store.has(clean)) return;
  store.set(clean, session);
}
