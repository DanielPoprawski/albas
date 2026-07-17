import type { Habit } from '../types';

export const HABIT_COLORS: Record<Habit['colorKey'], { text: string; hex: string }> = {
  primary: { text: 'text-primary-fixed-dim', hex: '#2563eb' },
  secondary: { text: 'text-secondary-container', hex: '#00a06c' },
  tertiary: { text: 'text-tertiary-fixed-dim', hex: '#d22348' },
};
