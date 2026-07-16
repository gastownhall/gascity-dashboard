// A supervisor identity (session alias, agent name, mail sender) is usually a
// clean alias ("mayor", "codex-1", "gascity/core.control-dispatcher"), but a
// worker in a worktree can report itself as a filesystem path, e.g.
// "/home/ds/gascity-packs/gascity-packs-polecat-1". Format that for display as
// "rig · agent" ("gascity-packs · polecat-1"); pass clean aliases through
// unchanged. Display only — never use the result as a routing key or identity.
import { canonicalRigLabel } from '../hooks/projectOf';

export function formatAgentName(raw: string): string {
  const value = raw.trim();
  if (value.length === 0) return value;
  if (!value.includes('/') && !value.includes('\\')) return value;

  const parts = value.split(/[\\/]/).filter((p) => p.length > 0);
  const agentSeg = parts[parts.length - 1];
  if (agentSeg === undefined) return value;
  const rawRig = parts[parts.length - 2];
  if (rawRig === undefined) return agentSeg;

  // Drop a redundant "<rig>-" prefix the worktree dir often carries
  // ("gascity-packs-polecat-1" under ".../gascity-packs" → "polecat-1"),
  // then canonicalize the rig ("gascity-main" → "gascity").
  const agent = agentSeg.startsWith(`${rawRig}-`) ? agentSeg.slice(rawRig.length + 1) : agentSeg;
  return `${canonicalRigLabel(rawRig)} · ${agent}`;
}
