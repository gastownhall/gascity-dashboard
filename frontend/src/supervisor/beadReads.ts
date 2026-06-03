import type {
  Bead,
  GetV0CityByCityNameBeadsData,
  ListBodyBead,
} from '../generated/gc-supervisor-client/types.gen';
import { getActiveCity } from '../api/cityBase';
import { SupervisorApiError, supervisorApi } from './client';

export type SupervisorBead = Bead;

export interface SupervisorBeadList extends Omit<ListBodyBead, 'items' | 'total'> {
  items: SupervisorBead[];
  total: number;
  upstream_total?: number;
  upstream_fetched: number;
  fetch_limit: number;
}

export interface ListSupervisorBeadsOptions {
  includeClosed?: boolean;
  includeBookkeeping?: boolean;
  rigFilter?: string;
  limit?: number;
}

const BEADS_FETCH_LIMIT = 2000;
const DETAIL_FALLBACK_FETCH_LIMIT = 2000;
const ENGINEERING_BEAD_TYPES: ReadonlySet<string> = new Set([
  'feature',
  'bug',
  'task',
  'docs',
]);

export async function listSupervisorBeads(
  options: ListSupervisorBeadsOptions = {},
): Promise<SupervisorBeadList> {
  const cityName = activeCityOrThrow('list supervisor beads');
  const limit = options.limit ?? BEADS_FETCH_LIMIT;
  const rigFilter = options.rigFilter?.trim() ?? '';
  const includeClosed = options.includeClosed ?? false;
  const includeBookkeeping = options.includeBookkeeping ?? false;
  const baseQuery: NonNullable<GetV0CityByCityNameBeadsData['query']> = {
    limit,
    ...(includeClosed ? { all: true } : {}),
    ...(rigFilter.length === 0 ? {} : { rig: rigFilter }),
  };
  const lists = includeBookkeeping
    ? [await supervisorApi().listBeads(cityName, baseQuery)]
    : await Promise.all(
      Array.from(ENGINEERING_BEAD_TYPES, (type) =>
        supervisorApi().listBeads(cityName, { ...baseQuery, type }),
      ),
    );
  const items = uniqueById(lists.flatMap((list) => list.items ?? []));
  const filtered = includeBookkeeping ? items : items.filter(defaultBeadFilter);
  const upstreamTotal = sumTotals(lists);
  return {
    items: filtered,
    total: filtered.length,
    ...(upstreamTotal === undefined ? {} : { upstream_total: upstreamTotal }),
    upstream_fetched: items.length,
    fetch_limit: limit,
  };
}

export async function fetchSupervisorBead(id: string): Promise<SupervisorBead> {
  const cityName = activeCityOrThrow('fetch supervisor bead');
  try {
    return await supervisorApi().getBead(cityName, id);
  } catch (err) {
    if (!(err instanceof SupervisorApiError) || err.status !== 404) throw err;

    const list = await supervisorApi().listBeads(cityName, {
      limit: DETAIL_FALLBACK_FETCH_LIMIT,
    });
    const hit = (list.items ?? []).find((bead) => bead.id === id);
    if (hit !== undefined) return hit;
    throw err;
  }
}

function defaultBeadFilter(bead: SupervisorBead): boolean {
  if (!ENGINEERING_BEAD_TYPES.has(bead.issue_type)) return false;
  if (Array.isArray(bead.labels) && bead.labels.some((label) => label.startsWith('gc:'))) {
    return false;
  }
  return true;
}

function activeCityOrThrow(operation: string): string {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error(`${operation} called before an active city was resolved`);
  }
  return cityName;
}

function countAsNumber(value: ListBodyBead['total']): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

function sumTotals(lists: readonly ListBodyBead[]): number | undefined {
  let total = 0;
  for (const list of lists) {
    const value = countAsNumber(list.total);
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

function uniqueById(items: readonly SupervisorBead[]): SupervisorBead[] {
  const seen = new Set<string>();
  const unique: SupervisorBead[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}
