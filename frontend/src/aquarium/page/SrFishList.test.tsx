import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { FishEntity } from '../contracts';
import { SrFishList } from './SrFishList';

afterEach(cleanup);

const FISH: FishEntity = {
  id: 'agent-keeper',
  name: 'keeper',
  species: 'role',
  isMayor: false,
  pose: 'working',
  poseWord: 'working',
  bellyPct: 64,
  homeKey: 'reef-beta',
  linkTo: '/agents/keeper',
  tombstoned: false,
};

describe('SrFishList', () => {
  it('reveals a keyboard-focused fish link without exposing the resting list visually', () => {
    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <SrFishList fish={[FISH]} />
      </MemoryRouter>,
    );

    const nav = screen.getByRole('navigation', { name: 'fish' });
    const link = screen.getByRole('link', { name: /reef-beta.*keeper.*working/i });
    const item = link.closest('li');

    expect(nav.className).not.toContain('sr-only');
    expect(item?.className).toContain('sr-only');
    expect(item?.className).toContain('focus-within:not-sr-only');
    expect(link.className).toContain('focus-mark');
  });
});
