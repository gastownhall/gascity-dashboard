import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PelletEntity } from '../contracts';
import { HoverTooltip } from './HoverTooltip';

function pellet(over: Partial<PelletEntity> = {}): PelletEntity {
  return {
    beadId: 'aoa-123',
    label: 'aoa-123',
    title: 'Repair the intake',
    linkTo: '/beads?bead=aoa-123',
    rigKey: 'aoa',
    state: 'drifting',
    ageFraction: 0,
    radiusScale: 1,
    ...over,
  };
}

describe('HoverTooltip pellet summary', () => {
  it('names the owning rig so a bead cluster never relies on colour inference alone', () => {
    render(
      <HoverTooltip
        hit={{ kind: 'pellet', entity: pellet() }}
        screenX={40}
        screenY={40}
        viewport={{ cssWidth: 1200, cssHeight: 800 }}
      />,
    );
    expect(screen.getByText(/repair the intake · open · aoa/i)).toBeTruthy();
  });
});
