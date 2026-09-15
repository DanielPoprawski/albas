import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * "Ada Lovelace" → "AL"; a single word gives its first letter. One
 * implementation for the status bar and Settings' Profile avatar, which
 * draw the same initials from the same account name.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
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
