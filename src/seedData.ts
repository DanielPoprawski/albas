import { CATEGORY_ACCENTS, DEFAULT_COLOR } from './colors';
import { fmt, parse, weekOf } from './dates';
import type { Todo } from './types';

const today = new Date();
const todayStr = fmt(today);

// Seed demo data on the current week (Sunday-first, `weekOf`'s default — the
// dashboard re-slices by the user's first day) but never on future days.
const weekDates = weekOf(today).filter((d) => d <= todayStr);
const weekAgo = new Date(today);
weekAgo.setDate(today.getDate() - 7);
const weekAgoStr = fmt(weekAgo);

const baseTodo = {
  kind: 'yesno' as const,
  unit: '',
  target: 1,
  dueDate: null,
  time: null,
  createdAt: weekAgoStr,
  reminder: false,
  category: '',
  important: false,
};

export const initialTodos: Todo[] = [
  {
    ...baseTodo,
    id: '1',
    name: 'Deep Work',
    colorKey: CATEGORY_ACCENTS.green.hex,
    kind: 'measurable',
    unit: 'h',
    target: 4,
    schedule: { type: 'weekdays', days: [1, 2, 3, 4, 5] },
    completions: Object.fromEntries(
      weekDates
        .filter((d) => {
          const day = parse(d).getDay();
          return day >= 1 && day <= 5;
        })
        .map((d) => [d, 4]),
    ),
  },
  {
    ...baseTodo,
    id: '2',
    name: 'Meditation',
    colorKey: CATEGORY_ACCENTS.purple.hex,
    schedule: { type: 'daily' },
    completions: Object.fromEntries(weekDates.filter((_, i) => i % 2 === 0).map((d) => [d, 1])),
  },
  {
    ...baseTodo,
    id: '3',
    name: 'Take out trash',
    colorKey: CATEGORY_ACCENTS.amber.hex,
    reminder: true,
    schedule: { type: 'every', n: 3, unit: 'day', fromDone: true },
    completions: weekDates.length > 2 ? { [weekDates[weekDates.length - 3]]: 1 } : {},
  },
  {
    ...baseTodo,
    id: '4',
    name: 'Finalize Q4 roadmap',
    colorKey: DEFAULT_COLOR,
    schedule: { type: 'once' },
    dueDate: todayStr,
    completions: {},
  },
];
