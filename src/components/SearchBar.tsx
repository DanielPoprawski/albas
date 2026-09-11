import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search, X, Trash2, Palette, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { addDays, parse } from '../dates';
import { colorHex } from '../colors';
import { registerFocusTarget } from '../focusRegistry';
import { isRepeating } from '../todoLogic';
import { buildMatcher, isRegexLiteral } from '../searchMatch';
import type { CalendarEvent, Todo } from '../types';
import { Checkbox } from './ui/checkbox';
import { IconButton } from './ui/button';
import { ColorPicker, Select } from './forms/shared';
import Highlighted from './Highlighted';
import AddModal from './AddModal';

export type SearchScope = 'calendar' | 'tasks' | 'habits';

type Hit =
  | { key: string; kind: 'event'; date: string; color: string; selectable: boolean; event: CalendarEvent }
  | { key: string; kind: 'todo'; date: string; color: string; selectable: boolean; todo: Todo };

const MAX_HITS = 50;

function eventHit(e: CalendarEvent): Hit {
  return {
    key: `e:${e.id}`,
    kind: 'event',
    date: e.startDate,
    color: colorHex(e.colorKey),
    selectable: !e.sharedBy,
    event: e,
  };
}

function todoHit(t: Todo): Hit {
  return {
    key: `t:${t.id}`,
    kind: 'todo',
    date: t.dueDate ?? t.createdAt,
    color: colorHex(t.colorKey),
    selectable: true,
    todo: t,
  };
}

function hitTitle(hit: Hit): string {
  return hit.kind === 'event' ? hit.event.title : hit.todo.name;
}

function prettyDate(dateStr: string): string {
  return parse(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The search bar mounted on the calendar, to-do and habits screens (styled
 * like a command-palette dropdown, but scoped to its own screen — not an
 * app-wide palette). Regex-capable (a `/pattern/flags` literal, or the `.*`
 * toggle), highlights matches in place, and supports selecting several hits
 * to bulk-delete/recolour/recategorise/shift-date/edit.
 *
 * The bar's own width never changes between closed and open — the results
 * panel is `absolute` under it at the same width — so opening it never
 * reflows whatever header it lives in.
 */
export default function SearchBar({ scope, className }: { scope: SearchScope; className?: string }) {
  const {
    events,
    sharedEvents,
    todos,
    setCurrentMonth,
    setSelectedDate,
    categoryById,
    categoriesFor,
    updateEvent,
    updateTodo,
    deleteEvent,
    deleteTodo,
  } = useApp();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [regexOn, setRegexOn] = useState(false);
  const [selected, setSelected] = useState<Map<string, Hit>>(new Map());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [shiftN, setShiftN] = useState(1);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | undefined>();
  const [editingTodo, setEditingTodo] = useState<Todo | undefined>();

  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // `/` is a global shortcut (shortcuts.ts); this just registers where it
  // should land while this bar is the one mounted for the active route.
  useEffect(() => {
    return registerFocusTarget('search', () => {
      input.current?.focus();
      input.current?.select();
    });
  }, []);

  // Click-away closes the list; the query and selection stay.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const effectiveRegex = regexOn || isRegexLiteral(query);
  const matcher = useMemo(() => buildMatcher(query, { regex: regexOn }), [query, regexOn]);

  const hits = useMemo<Hit[]>(() => {
    if (!matcher.ok || !query.trim()) return [];
    const test = (s: string) => matcher.test(s);
    const out: Hit[] = [];

    if (scope === 'calendar') {
      for (const e of events) {
        if (test(e.title) || test(e.description)) out.push(eventHit(e));
      }
      for (const e of sharedEvents) {
        if (test(e.title) || test(e.description)) out.push(eventHit(e));
      }
      for (const t of todos) {
        const catName = categoryById(t.category)?.name ?? '';
        if (test(t.name) || test(catName)) out.push(todoHit(t));
      }
    } else {
      const filtered = todos.filter((t) => (scope === 'tasks' ? !isRepeating(t) : isRepeating(t)));
      for (const t of filtered) {
        const catName = categoryById(t.category)?.name ?? '';
        if (test(t.name) || test(catName)) out.push(todoHit(t));
      }
    }

    // Soonest first, so what's coming up outranks what's long gone.
    const today = new Date().toISOString().slice(0, 10);
    out.sort(
      (a, b) =>
        Math.abs(a.date.localeCompare(today)) - Math.abs(b.date.localeCompare(today)) || a.date.localeCompare(b.date),
    );
    return out.slice(0, MAX_HITS);
  }, [query, matcher, scope, events, sharedEvents, todos, categoryById]);

  useEffect(() => setActive(0), [query]);

  function detailFor(hit: Hit): string {
    if (hit.kind === 'event') return hit.event.sharedBy ? `shared by ${hit.event.sharedBy}` : hit.event.description;
    return categoryById(hit.todo.category)?.name ?? '';
  }

  function rangesFor(text: string): [number, number][] {
    return matcher.ok ? matcher.ranges(text) : [];
  }

  function jump(hit: Hit) {
    const d = parse(hit.date);
    setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(hit.date);
    setOpen(false);
    input.current?.blur();
  }

  function primaryAction(hit: Hit) {
    if (scope === 'calendar') {
      jump(hit);
    } else if (hit.kind === 'todo') {
      setEditingTodo(hit.todo);
    } else {
      setEditingEvent(hit.event);
    }
  }

  function clear() {
    setQuery('');
    setOpen(false);
    input.current?.blur();
  }

  function toggleSelect(hit: Hit) {
    if (!hit.selectable) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(hit.key)) next.delete(hit.key);
      else next.set(hit.key, hit);
      return next;
    });
  }

  function selectAll() {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const hit of hits) if (hit.selectable) next.set(hit.key, hit);
      return next;
    });
  }

  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

  function applyDelete() {
    for (const hit of selectedList) {
      if (hit.kind === 'event') deleteEvent(hit.event.id);
      else deleteTodo(hit.todo.id);
    }
    setSelected(new Map());
    setConfirmDelete(false);
  }

  function applyColor(hex: string) {
    for (const hit of selectedList) {
      if (hit.kind === 'event') updateEvent(hit.event.id, { colorKey: hex });
      else updateTodo(hit.todo.id, { colorKey: hex });
    }
  }

  function applyCategory(catId: string) {
    for (const hit of selectedList) {
      if (hit.kind === 'event') updateEvent(hit.event.id, { category: catId });
      else updateTodo(hit.todo.id, { category: catId });
    }
  }

  function applyShift(days: number) {
    for (const hit of selectedList) {
      if (hit.kind === 'event') {
        updateEvent(hit.event.id, {
          startDate: addDays(hit.event.startDate, days),
          endDate: addDays(hit.event.endDate, days),
        });
      } else if (hit.todo.dueDate) {
        // Todos with no due date have nothing to shift — skipped rather than errored.
        updateTodo(hit.todo.id, { dueDate: addDays(hit.todo.dueDate, days) });
      }
    }
  }

  function openEditSelected() {
    if (selectedList.length !== 1) return;
    const hit = selectedList[0];
    if (hit.kind === 'event') setEditingEvent(hit.event);
    else setEditingTodo(hit.todo);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (selected.size > 0) setSelected(new Map());
      else clear();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const hit = hits[active];
      if (!hit) return;
      e.preventDefault();
      if (e.shiftKey) toggleSelect(hit);
      else primaryAction(hit);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
    }
  }

  const categoryOptions = [
    { value: '', label: 'None' },
    ...categoriesFor(scope).map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div ref={box} className={`relative w-[28rem] max-w-[50%] ${className ?? ''}`}>
      <div className="flex items-center gap-xs border border-line bg-surface px-xs focus-within:border-accent transition-colors">
        <Search size="0.875rem" className="text-ink-muted flex-shrink-0" aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search  /   ·  Shift+Enter select"
          aria-label={`Search ${scope}`}
          className="flex-1 min-w-0 py-[0.375rem] text-sm font-body bg-transparent border-none outline-none placeholder:text-ink-muted"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="text-ink-muted hover:text-ink flex-shrink-0"
          >
            <X size="0.875rem" />
          </button>
        )}
        <button
          type="button"
          aria-pressed={effectiveRegex}
          onClick={() => setRegexOn((r) => !r)}
          title="Regex mode (or type /pattern/flags)"
          className={`flex-shrink-0 px-1 text-xs font-bold font-mono border ${
            effectiveRegex ? 'border-accent bg-accent-tint text-accent' : 'border-line text-ink-muted hover:text-ink'
          }`}
        >
          .*
        </button>
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 top-full mt-xs w-full z-30 panel shadow-pop flex flex-col">
          {!matcher.ok ? (
            <div className="px-sm py-xs text-sm text-danger">Invalid pattern: {matcher.error}</div>
          ) : (
            <ul role="listbox" className="max-h-[24rem] overflow-y-auto">
              {hits.length === 0 && <li className="px-sm py-xs text-sm text-ink-muted">Nothing matches.</li>}
              {hits.map((hit, i) => {
                const title = hitTitle(hit);
                const detail = detailFor(hit);
                return (
                  <li key={hit.key} role="option" aria-selected={i === active}>
                    <div
                      className={`flex items-center gap-xs px-sm py-xs ${i === active ? 'bg-subtle-strong' : 'hover:bg-subtle-strong'}`}
                    >
                      {hit.selectable ? (
                        <Checkbox
                          checked={selected.has(hit.key)}
                          onCheckedChange={() => toggleSelect(hit)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${title}`}
                        />
                      ) : (
                        <span className="w-[1.125rem] flex-shrink-0" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => primaryAction(hit)}
                        className="flex-1 min-w-0 flex items-center gap-xs text-left"
                      >
                        {/* dynamic: the hit's own colour */}
                        <span className="w-2 h-2 flex-shrink-0" style={{ background: hit.color }} aria-hidden="true" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-ink truncate">
                            <Highlighted text={title} ranges={rangesFor(title)} />
                          </span>
                          {detail && (
                            <span className="block text-xs text-ink-muted truncate">
                              <Highlighted text={detail} ranges={rangesFor(detail)} />
                            </span>
                          )}
                        </span>
                        <span className="text-xs text-ink-muted flex-shrink-0">{prettyDate(hit.date)}</span>
                        <span className="micro-label flex-shrink-0">{hit.kind === 'event' ? 'event' : 'to-do'}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {selected.size > 0 && (
            <div className="border-t border-line px-sm py-xs flex flex-wrap items-center gap-xs">
              <span className="text-xs font-semibold text-ink flex-shrink-0">{selected.size} selected</span>

              {confirmDelete ? (
                <span className="flex items-center gap-xs text-xs">
                  Delete {selected.size}?
                  <button type="button" onClick={applyDelete} className="text-danger font-semibold hover:underline">
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-ink-muted hover:underline"
                  >
                    No
                  </button>
                </span>
              ) : (
                <IconButton title="Delete" aria-label="Delete selected" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size="0.8125rem" />
                </IconButton>
              )}

              <div className="relative">
                <IconButton
                  title="Colour"
                  aria-label="Set colour"
                  aria-pressed={colorOpen}
                  onClick={() => setColorOpen((o) => !o)}
                >
                  <Palette size="0.8125rem" />
                </IconButton>
                {colorOpen && (
                  <div className="absolute left-0 top-full mt-xs z-40 panel shadow-pop p-xs">
                    <ColorPicker
                      value={selectedList[0]?.color ?? ''}
                      onChange={(hex) => {
                        applyColor(hex);
                        setColorOpen(false);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="w-32 flex-shrink-0" title="Set category">
                <Select
                  options={categoryOptions}
                  value=""
                  onChange={(v) => applyCategory(v)}
                  className="!py-[0.25rem] text-xs"
                />
              </div>

              <div className="flex items-center gap-[0.125rem] flex-shrink-0">
                <IconButton title="Shift back 1 day" aria-label="Shift back 1 day" onClick={() => applyShift(-1)}>
                  <ChevronLeft size="0.8125rem" />
                </IconButton>
                <input
                  type="number"
                  min={1}
                  value={shiftN}
                  onChange={(e) => setShiftN(Math.max(1, Number(e.target.value) || 1))}
                  className="field-input w-10 text-center px-1 py-[0.125rem] text-xs"
                  aria-label="Days to shift"
                />
                <button
                  type="button"
                  onClick={() => applyShift(shiftN)}
                  className="text-xs text-ink-muted hover:text-ink px-1"
                >
                  shift
                </button>
                <IconButton title="Shift forward 1 day" aria-label="Shift forward 1 day" onClick={() => applyShift(1)}>
                  <ChevronRight size="0.8125rem" />
                </IconButton>
              </div>

              <IconButton
                title="Edit"
                aria-label="Edit selected"
                disabled={selectedList.length !== 1}
                onClick={openEditSelected}
              >
                <Pencil size="0.8125rem" />
              </IconButton>

              <button
                type="button"
                onClick={() => {
                  setSelected(new Map());
                  setConfirmDelete(false);
                  setColorOpen(false);
                }}
                className="ml-auto text-xs text-ink-muted hover:text-ink flex-shrink-0"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {editingEvent && <AddModal editEvent={editingEvent} onClose={() => setEditingEvent(undefined)} />}
      {editingTodo && <AddModal editTodo={editingTodo} onClose={() => setEditingTodo(undefined)} />}
    </div>
  );
}
