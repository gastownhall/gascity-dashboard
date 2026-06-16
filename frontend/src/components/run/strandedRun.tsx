// Single source for the "stranded run" copy shared by LaneCard, the run-detail
// skeleton, and the run-detail 404 branch, so the wording never drifts between
// them. Per DESIGN.md the state reads as glyph + word in greyscale — never color.

export const STRANDED_GLYPH = '(!)';
export const STRANDED_WORD = 'stranded';
export const STRANDED_EXPLANATION =
  'Dispatched but never registered with the supervisor, likely a supervisor restart or crash at dispatch time. This run never executed.';

// Run-detail notice: glyph + word + explanation in one status paragraph, used by
// the skeleton and the 404 branch. LaneCard composes the constants into its own
// layout instead, so it reads them directly rather than through this component.
export function StrandedRunNotice() {
  return (
    <p className="text-body text-fg-muted leading-snug" role="status">
      <span aria-hidden="true">{STRANDED_GLYPH}</span> {STRANDED_WORD}: {STRANDED_EXPLANATION}
    </p>
  );
}
