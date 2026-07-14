// Species + mayor detection. Shared verbatim by both live-session fish
// (SessionResponse fields) and fallback fish (AgentResponse fields, which
// carry no `alias`/`agent_kind` — the caller maps its own name into `alias`
// and `primaryName` so this stays one rule for both identity shapes).

import type { FishSpecies } from '../contracts';

const MAYOR_ALIAS = 'mayor';

export interface SpeciesIdentity {
  agentKind: string | undefined;
  alias: string | undefined;
  /** session_name for live sessions; agent.name for fallback agents. */
  primaryName: string;
  displayName: string | undefined;
}

export interface SpeciesResult {
  species: FishSpecies;
  isMayor: boolean;
}

/** `agent_kind === 'pool'` outranks mayor detection (a pool-kind identity is
 * never a grouper, even if its name happens to be "mayor"). */
export function deriveSpecies(identity: SpeciesIdentity): SpeciesResult {
  if (identity.agentKind === 'pool') return { species: 'pool', isMayor: false };
  if (isMayorIdentity(identity)) return { species: 'grouper', isMayor: true };
  return { species: 'role', isMayor: false };
}

function isMayorIdentity(identity: SpeciesIdentity): boolean {
  if (identity.alias === MAYOR_ALIAS) return true;
  if (equalsOrStartsWithMayor(identity.primaryName)) return true;
  if (identity.displayName !== undefined && equalsOrStartsWithMayor(identity.displayName)) {
    return true;
  }
  return false;
}

// `startsWith` subsumes strict equality; kept as one check per the spec's
// "equals or starts with" wording, which also documents intent: only a
// mayor-PREFIXED identity counts, not "mayor" appearing mid-string
// (e.g. "city-mayor-review" is a role, not the mayor).
function equalsOrStartsWithMayor(value: string): boolean {
  return value.startsWith(MAYOR_ALIAS);
}
