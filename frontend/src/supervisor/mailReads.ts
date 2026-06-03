import {
  OPERATOR_DISPLAY_ALIAS,
  OPERATOR_WIRE_ALIAS,
} from 'gas-city-dashboard-shared';
import type {
  MailListBody,
  Message,
} from '../generated/gc-supervisor-client/types.gen';
import { getActiveCity } from '../api/cityBase';
import {
  SupervisorApiError,
  supervisorApi,
} from './client';

export const MAIL_HISTORY_LIMITS = [100, 500, 1000] as const;
export type MailHistoryLimit = (typeof MAIL_HISTORY_LIMITS)[number];
export const DEFAULT_MAIL_HISTORY_LIMIT: MailHistoryLimit = 100;

export type SupervisorMailItem = Message;
export type SupervisorMailBox = 'inbox' | 'sent' | 'all';

export type SupervisorMailList = Omit<MailListBody, 'items'> & {
  items: SupervisorMailItem[];
  upstream_total?: number;
  upstream_fetched?: number;
  fetch_limit?: number;
};

export async function listSupervisorMail(
  box: SupervisorMailBox,
  alias: string,
  limit: MailHistoryLimit = DEFAULT_MAIL_HISTORY_LIMIT,
): Promise<SupervisorMailList> {
  const cityName = activeCityOrThrow('list supervisor mail');
  const mailList = await supervisorApi().listMail(cityName, { limit });
  const rawItems = mailList.items ?? [];
  const filtered = filterByBox(rawItems, box, alias);
  filtered.sort(sortNewestFirst);
  return {
    ...mailList,
    items: filtered,
    total: filtered.length,
    upstream_total: rawItems.length,
    upstream_fetched: rawItems.length,
    fetch_limit: limit,
  };
}

export async function fetchSupervisorMailThread(
  threadId: string,
  alias: string,
  limit: MailHistoryLimit = DEFAULT_MAIL_HISTORY_LIMIT,
): Promise<SupervisorMailList> {
  const cityName = activeCityOrThrow('fetch supervisor mail thread');
  try {
    const thread = await supervisorApi().mailThread(cityName, threadId);
    return normalizeThread(thread);
  } catch (err) {
    if (!(err instanceof SupervisorApiError) || err.status !== 404) throw err;
    const mailList = await listSupervisorMail('all', alias, limit);
    const items = mailList.items.filter((mail) => mail.thread_id === threadId);
    return normalizeThread({
      ...mailList,
      items,
      total: items.length,
    });
  }
}

function normalizeThread(mailList: MailListBody): SupervisorMailList {
  const items = dedupeById(mailList.items ?? []).sort(sortOldestFirst);
  return {
    ...mailList,
    items,
    total: items.length,
  };
}

function filterByBox(
  items: ReadonlyArray<SupervisorMailItem>,
  box: SupervisorMailBox,
  alias: string,
): SupervisorMailItem[] {
  const resolvedAlias = supervisorMailAlias(alias);
  if (box === 'all') return [...items];
  if (box === 'inbox') {
    return items.filter((mail) => mail.to.toLowerCase() === resolvedAlias);
  }
  return items.filter((mail) => mail.from.toLowerCase() === resolvedAlias);
}

function supervisorMailAlias(alias: string): string {
  const lower = alias.toLowerCase();
  return lower === OPERATOR_DISPLAY_ALIAS ? OPERATOR_WIRE_ALIAS : lower;
}

function dedupeById(items: ReadonlyArray<SupervisorMailItem>): SupervisorMailItem[] {
  const seen = new Set<string>();
  const deduped: SupervisorMailItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function sortNewestFirst(a: SupervisorMailItem, b: SupervisorMailItem): number {
  return b.created_at.localeCompare(a.created_at);
}

function sortOldestFirst(a: SupervisorMailItem, b: SupervisorMailItem): number {
  return a.created_at.localeCompare(b.created_at);
}

function activeCityOrThrow(operation: string): string {
  const cityName = getActiveCity();
  if (cityName === null) {
    throw new Error(`${operation} called before an active city was resolved`);
  }
  return cityName;
}
