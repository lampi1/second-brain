// Offscreen selection must retain identity without losing updates, then catch up immediately when visible again.
import { expect, it } from 'vitest';
import { visibleSnapshot } from '../../src/renderer/lib/visible-snapshot';

it('does not render unseen chunks and catches up to the newest snapshot on re-entry', () => {
  const select = visibleSnapshot<readonly string[] | undefined>(undefined);
  const initial = ['first'];
  expect(select(initial, false)).toBeUndefined();
  expect(select(initial, true)).toBe(initial);
  let latest = initial;
  for (let chunk = 0; chunk < 30; chunk++) {
    latest = [...latest, `chunk ${chunk}`];
    expect(select(latest, false)).toBe(initial);
  }
  expect(select(latest, true)).toBe(latest);
  expect(select([...latest, 'hidden again'], false)).toBe(latest);
});

it('keeps visible changes immediate and treats a visible reset as new state', () => {
  const select = visibleSnapshot<string | undefined>(undefined);
  expect(select('a', true)).toBe('a');
  expect(select('ab', true)).toBe('ab');
  expect(select(undefined, true)).toBeUndefined();
  expect(select('hidden', false)).toBeUndefined();
  expect(select('latest', true)).toBe('latest');
});
