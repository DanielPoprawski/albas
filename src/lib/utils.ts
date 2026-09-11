import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * True when applying `patch` to `base` would change nothing — field by field,
 * structurally (arrays and nested objects compared by content). Lets an edit
 * form skip a no-op update, which would otherwise bump `updated_at` and sync.
 */
export function samePatch<T extends object>(patch: Partial<T>, base: T): boolean {
  return (Object.keys(patch) as (keyof T)[]).every(
    (k) => JSON.stringify(patch[k] ?? null) === JSON.stringify(base[k] ?? null),
  );
}
