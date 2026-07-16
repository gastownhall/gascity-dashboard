// Pose derivation: the truthfulness contract's most load-bearing rule. The
// four distress poses are never re-derived here — they arrive verbatim as an
// already-resolved AgentNeedsYou row (selectAgentsNeedingYou is the SSOT; see
// fish.ts for how session/agent identities are joined to it). This module
// only derives the three CALM tiers from raw session facts.

import type { AgentNeedsYou } from 'gas-city-dashboard-shared';
import type { AquariumPose } from '../contracts';

/** A session idles into 'asleep' once this much time has passed with no activity. */
export const ASLEEP_THRESHOLD_MS = 3_600_000;
/** Keep a completed, explicitly observed turn visible through one 30s poll cycle. */
export const RECENT_ACTIVITY_WINDOW_MS = 60_000;

const POSE_WORD: Readonly<Record<AquariumPose, string>> = {
  working: 'working',
  idle: 'idle',
  asleep: 'asleep',
  'awaiting-input': 'awaiting input',
  stalled: 'stalled',
  'rate-limited': 'rate limited',
  errored: 'errored',
};

/** The overlay caption word for a pose. */
export function poseWord(pose: AquariumPose): string {
  return POSE_WORD[pose];
}

/**
 * User-facing calm-state label. Some providers, currently Codex and Gemini,
 * cannot expose authoritative turn activity through the supervisor's bounded
 * session list. An active process with no activity field is not evidence of
 * either an idle or an in-turn agent, so say exactly what is known.
 */
export function poseWordForSession(
  pose: AquariumPose,
  session: PoseSessionFacts,
  nowMs: number,
): string {
  if (turnActivityUnavailable(pose, session)) return 'activity unknown';
  if (pose === 'idle' && wasRecentlyActive(session, nowMs)) return 'active just now';
  return poseWord(pose);
}

/** True when a live session omits its provider's authoritative turn signal.
 * Ambient copy stays concise; detail surfaces explain this qualification. */
export function turnActivityUnavailable(pose: AquariumPose, session: PoseSessionFacts): boolean {
  return pose === 'idle' && isLiveWithoutTurnActivity(session);
}

function isLiveWithoutTurnActivity(session: PoseSessionFacts): boolean {
  const activity = session.activity?.trim().toLowerCase();
  const state = session.state?.trim().toLowerCase();
  return (
    (activity === undefined || activity.length === 0) &&
    (session.running === true || state === 'active' || state === 'running')
  );
}

function wasRecentlyActive(session: PoseSessionFacts, nowMs: number): boolean {
  if (session.activity?.trim().toLowerCase() !== 'idle' || session.last_active === undefined) {
    return false;
  }
  const lastActiveMs = Date.parse(session.last_active);
  if (Number.isNaN(lastActiveMs)) return false;
  const elapsedMs = nowMs - lastActiveMs;
  return elapsedMs >= 0 && elapsedMs < RECENT_ACTIVITY_WINDOW_MS;
}

const CALM_POSES: ReadonlySet<AquariumPose> = new Set(['working', 'idle', 'asleep']);

/** True for the four SSOT distress poses (the "needs attention" count). */
export function isDistressPose(pose: AquariumPose): boolean {
  return !CALM_POSES.has(pose);
}

/** The subset of session facts pose derivation needs, shared by both live
 * SessionResponse rows and the belly/task-free fallback-fish path. */
export interface PoseSessionFacts {
  activity?: string;
  state?: string;
  running?: boolean;
  last_active?: string;
}

/**
 * Resolve a fish's pose. `distress` is the already-resolved SSOT row for
 * this fish's identity, or undefined when the fish is not in the
 * needs-attention set. A fish with neither a distress row nor session facts
 * is a caller-contract violation (fallback fish only exist because they ARE
 * distressed) — fail loudly instead of guessing a calm pose.
 */
export function derivePose(
  distress: AgentNeedsYou | undefined,
  session: PoseSessionFacts | undefined,
  nowMs: number,
): AquariumPose {
  if (distress !== undefined) return distress.reason;
  if (session === undefined) {
    throw new Error('derivePose: a fish with no session must carry a distress reason');
  }
  if (session.activity === 'in-turn') return 'working';
  // A provider that cannot report turn activity must not let an old activity
  // timestamp override the supervisor's authoritative live process state.
  // Keep the calm visual pose; poseWordForSession supplies the truthful label.
  if (isLiveWithoutTurnActivity(session)) return 'idle';
  if (isAsleep(session, nowMs)) return 'asleep';
  return 'idle';
}

function isAsleep(session: PoseSessionFacts, nowMs: number): boolean {
  const state = session.state?.toLowerCase();
  if (state === 'asleep' || state === 'draining') return true;
  if (session.last_active === undefined) return false;
  const lastActiveMs = Date.parse(session.last_active);
  if (Number.isNaN(lastActiveMs)) return false;
  return nowMs - lastActiveMs >= ASLEEP_THRESHOLD_MS;
}
