import { useRef, type ReactNode } from 'react';
import { DropdownMenu, Popover as PopoverPrimitive } from 'radix-ui';
import { ArrowDown, ArrowUp, Check, MoreHorizontal, Palette, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Category, CategoryScope } from '../../types';
import { ColorPicker } from '../forms/shared';
import { PopoverContent } from '../ui/popover';

export const SCOPE_OPTIONS: { value: CategoryScope; label: string }[] = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'habits', label: 'Habits' },
];

/** The sidebar's hover-revealed "…" trigger: laid out always, painted on hover/focus/open. */
const TRIGGER =
  'flex size-5 shrink-0 cursor-pointer items-center justify-center text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 data-[state=open]:text-ink';

/** The menu surface: the `panel` hairline + `pop` shadow, as `ui/popover.tsx` paints it. */
const CONTENT =
  'z-50 min-w-[10rem] panel shadow-pop p-1 outline-none data-[state=open]:animate-[pop_150ms_ease-out_both] data-[state=closed]:animate-[pop_120ms_ease-in_reverse_both] motion-reduce:animate-none';

const ITEM =
  'flex cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-subtle data-[disabled]:pointer-events-none data-[disabled]:text-ink-muted';

const SEPARATOR = 'my-1 h-px bg-line';

export interface CategoryMenuProps {
  category: Category;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Rename / Color / Delete hand the row a mode; the row draws the inline input, picker or confirm. */
  onRename: () => void;
  onColor: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleScope: (scope: CategoryScope) => void;
  onDelete: () => void;
}

/**
 * The per-category management menu behind a sidebar row's "…" button (and its
 * right-click). Radix owns keyboard navigation, outside-click and Escape; the
 * three actions that open an inline control (rename, color, delete) tell Radix
 * not to return focus to the trigger, so the control gets it instead.
 */
export function CategoryMenu({
  category,
  open,
  onOpenChange,
  canMoveUp,
  canMoveDown,
  onRename,
  onColor,
  onMove,
  onToggleScope,
  onDelete,
}: CategoryMenuProps) {
  const keepFocus = useRef(false);
  const handOff = (fn: () => void) => () => {
    keepFocus.current = true;
    fn();
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={TRIGGER}
          aria-label={`Manage ${category.name}`}
          // The row behind is itself a button (toggle visibility); a click here is only the menu's.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size="0.875rem" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={CONTENT}
          onCloseAutoFocus={(e) => {
            if (keepFocus.current) e.preventDefault();
            keepFocus.current = false;
          }}
        >
          <DropdownMenu.Item className={ITEM} onSelect={handOff(onRename)}>
            <Pencil size="0.875rem" /> Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={handOff(onColor)}>
            <Palette size="0.875rem" /> Color
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Item className={ITEM} disabled={!canMoveUp} onSelect={() => onMove(-1)}>
            <ArrowUp size="0.875rem" /> Move up
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} disabled={!canMoveDown} onSelect={() => onMove(1)}>
            <ArrowDown size="0.875rem" /> Move down
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Label className="micro-label px-2 py-1">Show in</DropdownMenu.Label>
          {SCOPE_OPTIONS.map(({ value, label }) => (
            <DropdownMenu.CheckboxItem
              key={value}
              className={ITEM}
              checked={category.scopes.includes(value)}
              onCheckedChange={() => onToggleScope(value)}
              // Stay open so several scopes can be ticked in one visit.
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex size-3.5 items-center justify-center border border-line-strong text-accent">
                <DropdownMenu.ItemIndicator>
                  <Check size="0.625rem" strokeWidth={3} />
                </DropdownMenu.ItemIndicator>
              </span>
              {label}
            </DropdownMenu.CheckboxItem>
          ))}
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Item
            className={cn(ITEM, 'text-danger data-[highlighted]:bg-danger-tint')}
            onSelect={handOff(onDelete)}
          >
            <Trash2 size="0.875rem" /> Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * A `ColorPicker` in a small panel anchored to whatever it wraps — a sidebar
 * row or the new-category swatch. Controlled by the caller, so the menu's
 * "Color" item and the swatch button can both open it.
 */
export function ColorPopover({
  open,
  onOpenChange,
  value,
  onChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (hex: string) => void;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
      <PopoverContent align="start" className="w-auto">
        <ColorPicker value={value} onChange={onChange} />
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
