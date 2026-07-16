import type {
  FishEntity,
  PelletEntity,
  ReefFocus,
  RigFormation,
  WorldSnapshot,
} from '../contracts';
import { isDistressPose } from '../derive/pose';

export function isBackloggedRig(
  formation: RigFormation,
  unavailableRigKeys: ReadonlySet<string>,
): boolean {
  return formation.openBeadTotal > 0 && !unavailableRigKeys.has(formation.key);
}

export function isWaitingP0(
  pellet: PelletEntity,
  unavailableRigKeys: ReadonlySet<string>,
): boolean {
  return pellet.isP0 === true && pellet.state !== 'held' && !unavailableRigKeys.has(pellet.rigKey);
}

export function isAttentionFish(entity: FishEntity): boolean {
  return !entity.tombstoned && isDistressPose(entity.pose);
}

export function reefFocusIsEligible(
  snapshot: WorldSnapshot,
  focus: ReefFocus,
  unavailableRigKeys: readonly string[],
): boolean {
  const unavailable = new Set(unavailableRigKeys);
  switch (focus.kind) {
    case 'bead':
      return snapshot.pellets.some(
        (pellet) => pellet.beadId === focus.beadId && isWaitingP0(pellet, unavailable),
      );
    case 'rig':
      return snapshot.formations.some(
        (formation) => formation.key === focus.rigKey && isBackloggedRig(formation, unavailable),
      );
    case 'fish':
      return snapshot.fish.some((entity) => entity.id === focus.fishId && isAttentionFish(entity));
  }
}
