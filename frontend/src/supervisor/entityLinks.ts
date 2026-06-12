import type { EntityLinkView, DashboardSession } from 'gas-city-dashboard-shared';
import { buildLinkView, buildRelationIndex, parseRef } from 'gas-city-dashboard-shared';
import { activeCityOrThrow } from '../api/cityBase';
import { supervisorApi } from './client';
import { listIsIncomplete } from './listPartial';
import { normalizeBeads } from './normalizeBead';
import { normalizeSessions, type SupervisorSessionList } from './sessionReads';

// Pre-exposure load bound (gascity-dashboard-q89b): this fetch runs once per
// focus ref per client, so the limit multiplies across viewers. Truncation is
// safe: the partial flag below trips when upstream total exceeds what was
// fetched, and RelatedEntities renders the partial notice.
const LINKS_FETCH_LIMIT = 1_000;

export async function loadSupervisorEntityLinks(ref: string): Promise<EntityLinkView> {
  const parsed = parseRef(ref);
  if (!parsed.ok) throw new Error(parsed.error);

  const cityName = activeCityOrThrow('load supervisor entity links');
  const supervisorFetchedAt = new Date().toISOString();
  const beadList = await supervisorApi().listBeads(cityName, { limit: LINKS_FETCH_LIMIT });
  const beads = normalizeBeads(beadList.items ?? []);
  let partial = listIsIncomplete(beadList, beads.length);

  let sessions: DashboardSession[] = [];
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

function sessionListIsPartial(list: SupervisorSessionList): boolean {
  return list.partial === true || (list.partial_errors?.length ?? 0) > 0;
}
