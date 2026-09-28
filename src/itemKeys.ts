import type { ItemKey, Seed } from './types';

export function seedKey(s: Pick<Seed, 'id'>): ItemKey {
  return `seed:${s.id}`;
}
