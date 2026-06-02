import type { GcBead } from 'gas-city-dashboard-shared';
import { useEffect, useState } from 'react';
import { api, apiErrorParts, formatApiError } from '../api/client';
import { useNow } from '../contexts/NowContext';

// Shared fetch state for a single bead's detail surface
// (gascity-dashboard-6frc). The BeadDetailModal renders this from both the
// Beads board and the AgentDetail assigned-beads list, so the "fetch by id
// when the cached row lacks a description" logic lives here once rather
// than in each surface.

export interface BeadDetailState {
  bead: GcBead | null;
  loading: boolean;
  error: string | null;
  /** Live clock (ms) for RelatedEntities staleness / "as of". */
  now: number;
}

/**
 * Loads `beadId` while `active`. If `initialBead` already carries a
 * description (the freshness signal — it's the thing the detail surface
 * exists to show), the fetch is skipped. Relative ages use the app-wide
 * NowProvider clock so detail surfaces stay consistent with the page.
 */
export function useBeadDetail(
  active: boolean,
  beadId: string | null,
  initialBead: GcBead | null = null,
): BeadDetailState {
  const [bead, setBead] = useState<GcBead | null>(initialBead);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    if (!active || !beadId) return;
    if (
      initialBead &&
      initialBead.id === beadId &&
      initialBead.description !== undefined
    ) {
      setBead(initialBead);
      setError(null);
      return;
    }
    setBead(initialBead?.id === beadId ? initialBead : null);
    setLoading(true);
    setError(null);
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.getBead(beadId);
        if (!cancelled) setBead(result);
      } catch (err) {
        if (cancelled) return;
        const parts = apiErrorParts(err, 'fetch failed');
        setError(
          parts.status === 404
            ? 'Bead not found in the supervisor.'
            : formatApiError(err, 'fetch failed'),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, beadId, initialBead]);

  return { bead, loading, error, now };
}
