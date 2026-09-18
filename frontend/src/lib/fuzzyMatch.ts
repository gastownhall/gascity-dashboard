// Tiny in-repo fuzzy matcher for the quick-jump palette — a subsequence
// match (every query character must appear in `target`, in order, but not
// necessarily adjacent), scored so tighter matches rank first. No external
// dependency: the match set here is a few hundred rows, not a search index.

const WORD_BOUNDARY_RE = /[\s\-_/]/;

/**
 * Returns a score (higher is a better match) or `null` when `query`'s
 * characters don't all appear, in order, within `target`. Case-insensitive.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return 0;

  let score = 0;
  let qi = 0;
  let prevMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] !== q[qi]) continue;
    const isWordStart = ti === 0 || WORD_BOUNDARY_RE.test(t[ti - 1] ?? '');
    const isConsecutive = prevMatchIndex === ti - 1;
    score += isConsecutive ? 3 : isWordStart ? 2 : 1;
    prevMatchIndex = ti;
    qi += 1;
  }

  if (qi < q.length) return null;

  // Shorter targets and matches concentrated near the front rank slightly
  // higher when match quality is otherwise equal.
  score -= t.length * 0.01;
  return score;
}
