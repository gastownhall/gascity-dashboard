// Run with: npx tsx --test shared/src/run-snapshot.test.ts
//
// gascity-dashboard-ox06: RunSnapshotBead/RunSnapshotDep used to be hand-typed
// mirrors of the generated supervisor client's WorkflowBeadResponse/
// WorkflowDepResponse (AGENTS.md forbids mirroring supervisor wire shapes in
// shared). They are now type aliases of the generated types directly, so a
// future supervisor schema change surfaces here instead of silently drifting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source-text check, not a structural/assignability test: TypeScript's structural
// typing can't tell a true alias apart from a hand-rolled interface with matching
// fields, so this is the only way to guard against reintroducing the hand mirror.
test('RunSnapshotBead/RunSnapshotDep are aliases of the generated wire types, not hand mirrors', () => {
  const source = readFileSync(new URL('./run-snapshot.ts', import.meta.url), 'utf8');

  // Whitespace-tolerant so a reformat (extra spaces/newlines) can't fail the
  // guard while the types remain true aliases.
  assert.doesNotMatch(source, /export\s+interface\s+RunSnapshotBead\b/);
  assert.doesNotMatch(source, /export\s+interface\s+RunSnapshotDep\b/);
  assert.match(source, /export\s+type\s+RunSnapshotBead\s*=\s*WorkflowBeadResponse\s*;/);
  assert.match(source, /export\s+type\s+RunSnapshotDep\s*=\s*WorkflowDepResponse\s*;/);
});
