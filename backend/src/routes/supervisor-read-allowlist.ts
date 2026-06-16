// Default-deny read-endpoint allowlist for the `/gc-supervisor` transport proxy
// when DASHBOARD_READONLY=1 (exposure-hardening PRD M1 / bead z8n7).
//
// Only GET/HEAD requests whose path matches one of these templates are
// forwarded to the supervisor; every other path is rejected with 404. The list
// is deliberately the *minimal* set of supervisor reads the dashboard SPA
// performs — see the `getV0*` / SSE calls in `frontend/src/supervisor/*`. A new
// read view must be added here to work under read-only mode; until then it
// fails closed, which is the intended posture for an externally exposed
// instance.
//
// Side-effecting GETs are excluded on purpose. `agent/{base}/prime` (and its
// `{dir}/{base}` variant) is a state-changing GET flagged by the exposure
// premortem, so neither it nor the dynamic two-segment agent-detail reads are
// allowlisted — keeping the agent surface to the inert `agents` listing also
// avoids a `[^/]+`-collision where `agent/{base}/prime` would otherwise match a
// generic `agent/{dir}/{base}` pattern.
const READ_ENDPOINT_TEMPLATES = [
  '/health',
  '/v0/cities',
  '/v0/city/{cityName}/agents',
  '/v0/city/{cityName}/beads',
  '/v0/city/{cityName}/beads/graph/{rootID}',
  '/v0/city/{cityName}/bead/{id}',
  '/v0/city/{cityName}/events',
  '/v0/city/{cityName}/events/stream',
  '/v0/city/{cityName}/formulas/feed',
  '/v0/city/{cityName}/formulas/{name}',
  '/v0/city/{cityName}/health',
  '/v0/city/{cityName}/mail',
  '/v0/city/{cityName}/mail/thread/{id}',
  '/v0/city/{cityName}/sessions',
  '/v0/city/{cityName}/session/{id}/pending',
  '/v0/city/{cityName}/session/{id}/stream',
  '/v0/city/{cityName}/session/{id}/transcript',
  '/v0/city/{cityName}/status',
  '/v0/city/{cityName}/workflow/{workflow_id}',
] as const;

const READ_ENDPOINT_PATTERNS: readonly RegExp[] = READ_ENDPOINT_TEMPLATES.map(templateToPattern);

/** True when `path` (proxy-relative, query stripped) is an allowlisted read. */
export function isAllowedReadPath(path: string): boolean {
  if (hasTraversal(path)) return false;
  return READ_ENDPOINT_PATTERNS.some((pattern) => pattern.test(path));
}

// Reject anything that could resolve to a different upstream path than the one
// being checked. `new URL(req.url, base)` (used to build the forwarded target)
// resolves `..`/`.` segments, decodes percent-escapes (`%2e` → `.`), and treats
// `\` as `/` for http URLs. A path like `/v0/city/../events/stream` — or its
// encoded form `/v0/city/%2e%2e/events/stream` — would otherwise satisfy the
// per-city `{cityName}` template (`[^/]+` matches `..`/`%2e%2e`) yet forward to
// the GLOBAL `/v0/events/stream` cross-city stream, defeating read-only mode in
// a multi-city deployment. No legitimate supervisor read path contains a `.`/`..`
// segment, an encoded dot, or a backslash, so all fail closed — keeping the
// checked path equal to the forwarded path regardless of how it was encoded. The
// per-segment check compares each segment's matrix-parameter prefix (`..;x` →
// `..`): a `..;`/`.;` segment is inert against the current Express supervisor
// (it doesn't strip `;`-suffixes) but would resolve to a traversal if the
// upstream framework ever did, so it fails closed now rather than latently.
function hasTraversal(path: string): boolean {
  if (path.includes('\\')) return true;
  if (path.toLowerCase().includes('%2e')) return true;
  return path.split('/').some((segment) => {
    const bare = segment.split(';')[0];
    return bare === '..' || bare === '.';
  });
}

// `{param}` segments match a single path segment; literal segments match
// exactly. Anchored at both ends so a longer path (e.g. an action suffix) never
// satisfies a shorter template.
function templateToPattern(template: string): RegExp {
  const body = template
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}')
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${body}$`);
}
