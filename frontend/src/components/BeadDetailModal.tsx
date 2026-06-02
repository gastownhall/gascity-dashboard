import { useState } from "react";
import type { GcBead, GcSession } from "gas-city-dashboard-shared";
import { resolveSessionForTarget } from "gas-city-dashboard-shared";
import type { BeadNode } from "../lib/beadGraph";
import { useBeadDetail } from "../hooks/useBeadDetail";
import { useEntityLinks } from "../hooks/useEntityLinks";
import { BeadBody } from "./BeadBody";
import { BeadDependencies } from "./beads/BeadDependencies";
import { BeadLiveRunModal } from "./beads/BeadLiveRunModal";
import { Button } from "./Button";
import { isSessionStreamable } from "./LiveSessionPeek";
import { Modal } from "./Modal";
import { RelatedEntities } from "./RelatedEntities";

// Click-to-read pop-out for a single bead. Used from the Beads board and
// the AgentDetail assigned-beads list. Pure read view; mutations
// (claim/close/nudge) live on the Beads page row actions and are
// deliberately not duplicated here.
//
// Fetches /api/beads/:id on open. If the caller already has the full
// bead in state (Beads, AgentDetail), it can pass it via `initialBead`
// so the modal renders immediately and skips the network round trip.
//
// gascity-dashboard-14s1: when the caller supplies the bead's resolved
// graph node (`depNode`) the modal renders its needs/blocks dependency
// tree; when it supplies `sessions`, an assignee that resolves to a
// streamable session gets the same "View live run" click-through the
// board's detail rail used to offer. Both are optional, so the standalone
// callers (AgentDetail, FormulaRunDetail) render unchanged.

interface BeadDetailModalProps {
  open: boolean;
  onClose: () => void;
  beadId: string | null;
  /** Optional pre-loaded bead. When present and complete, skips the fetch. */
  initialBead?: GcBead | null;
  /**
   * Re-center the modal on a related bead (gascity-dashboard-j4x). When
   * omitted, related bead rows render as plain text (no in-place
   * navigation) so the modal can be used standalone.
   */
  onOpenBead?: (beadId: string) => void;
  /** Resolved graph node for the bead; when present, shows the dependency tree. */
  depNode?: BeadNode | null;
  /** Session list for assignee → live-run resolution; enables "View live run". */
  sessions?: readonly GcSession[];
}

export function BeadDetailModal({
  open,
  onClose,
  beadId,
  initialBead = null,
  onOpenBead,
  depNode = null,
  sessions,
}: BeadDetailModalProps) {
  const { bead, loading, error, now } = useBeadDetail(open, beadId, initialBead);
  const links = useEntityLinks(open ? beadId : null);
  const [runOpen, setRunOpen] = useState(false);

  const session =
    bead && sessions && bead.assignee && bead.assignee.length > 0
      ? resolveSessionForTarget(bead.assignee, sessions)
      : null;
  const liveRunnable = isSessionStreamable(session);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={bead?.title ?? beadId ?? "Bead"}
        caption={
          bead ? (
            <span>
              <code className="text-fg-muted">{bead.id}</code>
              {" · "}
              {bead.issue_type}
              {" · P"}
              {bead.priority === null ? "—" : bead.priority}
            </span>
          ) : beadId ? (
            <code className="text-fg-muted">{beadId}</code>
          ) : undefined
        }
        widthClass="max-w-3xl"
        footer={
          liveRunnable ? (
            <Button size="sm" tone="quiet" onClick={() => setRunOpen(true)}>
              View live run ↗
            </Button>
          ) : undefined
        }
      >
        {error ? (
          <p className="text-accent" role="alert">
            {error}
          </p>
        ) : loading && bead === null ? (
          <p className="text-fg-muted italic">Fetching bead.</p>
        ) : bead === null ? (
          <p className="text-fg-muted italic">No bead.</p>
        ) : (
          <div className="space-y-8">
            <BeadBody bead={bead} />
            {depNode && (
              <BeadDependencies
                node={depNode}
                {...(onOpenBead !== undefined ? { onOpenBead } : {})}
              />
            )}
            <RelatedEntities
              view={links.view}
              loading={links.loading}
              error={links.error}
              now={now}
              {...(onOpenBead !== undefined ? { onOpenBead } : {})}
            />
          </div>
        )}
      </Modal>

      {bead && (
        <BeadLiveRunModal
          open={runOpen}
          onClose={() => setRunOpen(false)}
          session={session}
          beadTitle={bead.title}
        />
      )}
    </>
  );
}
