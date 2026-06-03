import fs from 'node:fs/promises';
import path from 'node:path';
import type { SlungState, TriageKind } from 'gas-city-dashboard-shared';
import { LOG_COMPONENT, errorMessage, logWarn } from '../../../logging.js';
import { BEAD_ID_RE } from '../../../lib/beadId.js';

// Active sling state persistence (gascity-dashboard-9qs).
//
// JSON map keyed by `kind:number`. Single-repo scope: this dashboard
// runs against one Gas City fork at a time, and the slung-state file lives
// in the same directory as the maintainer envelope cache, so the directory
// itself carries the repo scope.
//
// Atomic tmp+rename mirrors the sibling storage.ts. An
// in-process Promise-chain mutex serialises read-modify-write so two
// concurrent slings to different items don't lose updates to the
// classic read-old / modify / write-newer race. The mutex is courtesy:
// the tmp+rename is the correctness guarantee against torn writes.
//
// Read failures (missing file, malformed JSON, wrong top-level shape)
// return an empty map plus an operational warning — never throw. This file is
// derived bookkeeping; a corrupt copy must not break the maintainer
// view's serve path.

export type SlungStateMap = Record<string, SlungState>;

/**
 * Intermediate shape used between `isValidStateMap` and
 * `normalizeLegacyEntries`. A parsed-but-not-yet-coerced entry: the
 * structural fields the validator confirms (`slung_at`, `target`, `bead_id`)
 * are required and well-typed; `resolved_session_name` is the one field
 * allowed to be absent on pre-55b legacy files (gascity-dashboard-oc4l).
 *
 * Modelling it as a `Partial`-of-the-legacy-field rather than reusing the
 * strict `SlungState` makes the runtime `=== undefined` check in the
 * normalizer type-honest — TypeScript can see the field is statically
 * possibly-undefined here, instead of inspecting a field declared
 * non-optional `string | null`. Local to this module; do not export.
 * Once all deployed operators have rotated past gascity-dashboard-55b, the
 * legacy migration (and this alias) can be retired together.
 */
type PrenormalizedSlungEntry = Omit<SlungState, 'resolved_session_name'> & {
  resolved_session_name?: SlungState['resolved_session_name'];
};
type PrenormalizedSlungStateMap = Record<string, PrenormalizedSlungEntry>;

/**
 * Stable key for a TriageItem in the slung-state map.
 * Use this rather than concatenating inline so the format stays
 * consistent across read, write, and purge call sites.
 */
export function slungKey(kind: TriageKind, number: number): string {
  return `${kind}:${number}`;
}

export async function readSlungState(statePath: string): Promise<SlungStateMap> {
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidStateMap(parsed)) {
      logWarn(LOG_COMPONENT.maintainer, `slung-state at ${statePath} failed shape check; ignoring`);
      return {};
    }
    return normalizeLegacyEntries(parsed, statePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    logWarn(LOG_COMPONENT.maintainer, `slung-state read failed: ${errorMessage(err)}`);
    return {};
  }
}

// Serialise read-modify-write across concurrent writers in this
// process. Single chain — every writer waits for the prior to finish
// before reading the current map. Different paths share the chain
// (one mutex covers the slung-state file; this module owns a single
// file per process). If multi-process writers ever appear, swap for
// per-path fs locking via proper-lockfile or similar.
let writeChain: Promise<void> = Promise.resolve();

export async function writeSlungEntry(
  statePath: string,
  key: string,
  entry: SlungState,
): Promise<void> {
  const next = writeChain.then(async () => {
    const current = await readSlungState(statePath);
    // Immutable next-state: never mutate the map readSlungState handed
    // us, so the in-process map snapshot stays a pure read of disk and
    // a future concurrent reader holding the same reference can't see
    // a half-written update.
    const nextState: SlungStateMap = { ...current, [key]: entry };
    await persistAtomic(statePath, nextState);
  });
  keepWriteChainAlive(next, 'write');
  await next;
}

export async function purgeSlungKeys(
  statePath: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const next = writeChain.then(async () => {
    const current = await readSlungState(statePath);
    const toPurge = new Set(keys);
    // Immutable filter: rebuild the map without the purged keys rather
    // than `delete`-ing in-place. If nothing matched, skip the write.
    const filteredEntries = Object.entries(current).filter(([k]) => !toPurge.has(k));
    if (filteredEntries.length === Object.keys(current).length) return;
    const nextState: SlungStateMap = Object.fromEntries(filteredEntries);
    await persistAtomic(statePath, nextState);
  });
  keepWriteChainAlive(next, 'purge');
  await next;
}

// gascity-dashboard: the serialized write chain must survive a failed
// write/purge so the NEXT enqueued op still runs, but a swallowed
// `.catch(() => undefined)` hides a persistence failure entirely. Log the
// failure instead — the chain stays alive AND the operator sees that the
// slung-state write did not land.
function keepWriteChainAlive(next: Promise<void>, operation: 'write' | 'purge'): void {
  writeChain = next.catch((err: unknown) => {
    logWarn(LOG_COMPONENT.maintainer, `slung-state ${operation} failed: ${errorMessage(err)}`);
  });
}

async function persistAtomic(statePath: string, state: SlungStateMap): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, statePath);
}

function isValidStateMap(v: unknown): v is PrenormalizedSlungStateMap {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  for (const entry of Object.values(v)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    // gascity-dashboard-smto: use `Record<string, unknown>` + property
    // probes rather than `as Partial<SlungState>`. The Partial cast
    // accepts ANY object structurally — its only constraint is that
    // *present* fields match SlungState, and present fields can also
    // simply not exist. That hides missing-required-field bugs from
    // the type system: `e.slung_at` reads as `string | undefined` either
    // way, so the typeof check is doing all the work. Make that explicit.
    const e = entry as Record<string, unknown>;
    if (!('slung_at' in e) || typeof e.slung_at !== 'string') return false;
    if (!('target' in e) || typeof e.target !== 'string') return false;
    if (!('bead_id' in e) || (e.bead_id !== null && typeof e.bead_id !== 'string')) return false;
    // gascity-dashboard-djpk: bead_id flows to the wire as TriageItem.run_id
    // and into a run-detail link, so validate it against the same allowlist the write
    // side uses (runs.ts / link parsing) at this disk-read trust boundary rather
    // than relying solely on the downstream route validator.
    if (typeof e.bead_id === 'string' && !BEAD_ID_RE.test(e.bead_id)) return false;
    // gascity-dashboard-oc4l: resolved_session_name is OPTIONAL on disk.
    // Pre-55b entries (written before gascity-dashboard-55b added
    // resolved_session_name persistence) don't carry the field;
    // normalizeLegacyEntries() coerces absent -> null at the read edge so
    // downstream consumers see the strict wire shape (string | null).
    // Reject only when the field is present AND neither null nor string —
    // that's a real shape violation, not a legacy file.
    if ('resolved_session_name' in e) {
      // `rsn` (not `v`) so we don't shadow the outer `v: unknown`
      // parameter of isValidStateMap — a reader diffing the function
      // shouldn't have to track which scope `v` refers to.
      const rsn = e.resolved_session_name;
      if (rsn !== null && typeof rsn !== 'string') return false;
    }
  }
  return true;
}

/**
 * Coerce absent `resolved_session_name` to `null` so the returned map matches
 * the strict wire shape (SlungState.resolved_session_name is `string | null`,
 * non-optional). Logs once per read when any legacy entries were migrated so
 * the upgrade condition is operationally visible, not silent. Pre-55b entries
 * are the only legitimate source of an absent field; once all deployed
 * operators have rotated past gascity-dashboard-55b, this migration and the
 * `!== undefined` guard above can be removed (follow-up bead).
 *
 * See the `PrenormalizedSlungEntry` type definition above for the rationale
 * of the input shape and the `??` coercion semantics.
 */
function normalizeLegacyEntries(
  map: PrenormalizedSlungStateMap,
  statePath: string,
): SlungStateMap {
  let migrated = 0;
  const normalized: SlungStateMap = Object.fromEntries(
    Object.entries(map).map(([key, entry]) => {
      if (entry.resolved_session_name === undefined) migrated += 1;
      return [
        key,
        {
          slung_at: entry.slung_at,
          target: entry.target,
          bead_id: entry.bead_id,
          resolved_session_name: entry.resolved_session_name ?? null,
        },
      ];
    }),
  );
  if (migrated > 0) {
    logWarn(
      LOG_COMPONENT.maintainer,
      `slung-state at ${statePath}: normalized ${migrated} pre-55b entr${migrated === 1 ? 'y' : 'ies'} ` +
        `with absent resolved_session_name (gascity-dashboard-55b migration)`,
    );
  }
  return normalized;
}
