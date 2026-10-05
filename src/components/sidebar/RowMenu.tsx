import { DropdownMenu, Popover as PopoverPrimitive } from 'radix-ui';
import { type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';
import { TAG_ICONS } from '../../tagIcons';
import { Icon } from '../ui/icon';
import { PopoverContent } from '../ui/popover';

/** The sidebar's hover-revealed "…" trigger: laid out always, painted on hover/focus/open. */
const TRIGGER =
  'flex size-5 shrink-0 cursor-pointer items-center justify-center text-ink-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 data-[state=open]:text-ink [@media(pointer:coarse)]:opacity-100';

/** The menu surface: the `panel` hairline + `pop` shadow, as `ui/popover.tsx` paints it. */
const CONTENT =
  'z-50 min-w-[10rem] panel shadow-pop p-1 data-[state=open]:animate-[pop_150ms_ease-out_both] data-[state=closed]:animate-[pop_120ms_ease-in_reverse_both] motion-reduce:animate-none';

const ITEM =
  'flex cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-sm text-ink data-[highlighted]:bg-subtle data-[disabled]:pointer-events-none data-[disabled]:text-ink-muted';

const SEPARATOR = 'my-1 h-px bg-line';

export interface RowMenuProps {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Rename / Colour / Icon / Delete hand the row a mode; the row draws the inline input, picker or confirm. */
  onRename: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  /** Tags only: present = the menu offers Colour and Icon. */
  onColor?: () => void;
  onIcon?: () => void;
}

/**
 * The management menu behind a sidebar row's "…" button (and its right-click)
 * for a list or a tag. Radix owns keyboard navigation, outside-click and
 * Escape; the actions that open an inline control (rename, colour, icon,
 * delete) tell Radix not to return focus to the trigger, so the control gets
 * it instead.
 */
export function RowMenu({
  name,
  open,
  onOpenChange,
  canMoveUp,
  canMoveDown,
  onRename,
  onMove,
  onDelete,
  onColor,
  onIcon,
}: RowMenuProps) {
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
          aria-label={`Manage ${name}`}
          // The row behind is itself a button (toggle visibility); a click here is only the menu's.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Icon name="more_horiz" size="0.875rem" />
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
            <Icon name="edit" size="0.875rem" /> Rename
          </DropdownMenu.Item>
          {onColor && (
            <DropdownMenu.Item className={ITEM} onSelect={handOff(onColor)}>
              <Icon name="palette" size="0.875rem" /> Colour
            </DropdownMenu.Item>
          )}
          {onIcon && (
            <DropdownMenu.Item className={ITEM} onSelect={handOff(onIcon)}>
              <Icon name="star" size="0.875rem" /> Icon
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Item className={ITEM} disabled={!canMoveUp} onSelect={() => onMove(-1)}>
            <Icon name="arrow_upward" size="0.875rem" /> Move up
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} disabled={!canMoveDown} onSelect={() => onMove(1)}>
            <Icon name="arrow_downward" size="0.875rem" /> Move down
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={SEPARATOR} />
          <DropdownMenu.Item
            className={cn(ITEM, 'text-danger data-[highlighted]:bg-danger-tint')}
            onSelect={handOff(onDelete)}
          >
            <Icon name="delete" size="0.875rem" /> Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The grid a tag's icon is picked from: `TAG_ICONS`, eight across. */
export function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {TAG_ICONS.map((name) => (
        <button
          key={name}
          type="button"
          title={name.replace(/_/g, ' ')}
          aria-pressed={value === name}
          onClick={() => onChange(name)}
          className={cn(
            'flex size-7 items-center justify-center transition-colors',
            value === name ? 'bg-accent text-on-accent' : 'text-ink-secondary hover:bg-subtle hover:text-ink',
          )}
        >
          <Icon name={name} size="1rem" />
        </button>
      ))}
    </div>
  );
}

/** An `IconPicker` in a small panel anchored to whatever it wraps. Controlled by the caller. */
export function IconPopover({
  open,
  onOpenChange,
  value,
  onChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (icon: string) => void;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor>{children}</PopoverPrimitive.Anchor>
      <PopoverContent align="start" className="w-auto">
        <IconPicker value={value} onChange={onChange} />
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
