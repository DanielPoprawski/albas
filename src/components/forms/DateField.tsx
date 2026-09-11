import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { fieldDate } from '../../dates';
import { parseStrictDate } from '../../nlDate';

/**
 * A date as a plain text field. Shows "Thu 18 Sep 2026"; accepts anything
 * chrono's strict parser takes ("18 sep", "sep 18", "18/9", "2026-09-18") and
 * commits on Enter or blur. Casual phrases ("tomorrow", "next friday") are
 * deliberately not accepted here — those belong in the title, where the
 * suggestion chip makes the interpretation visible before it lands.
 * Enter on an unparseable value marks the field and keeps focus; leaving it
 * reverts to the last good date; Escape reverts in place.
 */
export default function DateField({
  value,
  onChange,
  allowEmpty = false,
  placeholder = 'e.g. 18 Sep',
  className,
  ...rest
}: {
  /** `YYYY-MM-DD`, or '' when `allowEmpty`. */
  value: string;
  onChange: (next: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(() => fieldDate(value));
  const [invalid, setInvalid] = useState(false);

  // Follow the parent (e.g. moving the start drags the end along).
  useEffect(() => {
    setText(fieldDate(value));
    setInvalid(false);
  }, [value]);

  const pristine = !invalid && text === fieldDate(value);

  /** True when the field now reflects a valid value. */
  function commit(): boolean {
    const raw = text.trim();
    if (!raw) {
      if (allowEmpty) {
        onChange('');
        setText('');
        setInvalid(false);
        return true;
      }
      return false;
    }
    const parsed = parseStrictDate(raw);
    if (!parsed) {
      setInvalid(true);
      return false;
    }
    onChange(parsed);
    setText(fieldDate(parsed));
    setInvalid(false);
    return true;
  }

  function revert() {
    setText(fieldDate(value));
    setInvalid(false);
  }

  return (
    <input
      type="text"
      inputMode="text"
      autoComplete="off"
      enterKeyHint="done"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        if (!commit()) revert();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape' && !pristine) {
          // Consumed here: an edited field reverts; the modal only closes on
          // a second Escape.
          e.preventDefault();
          e.stopPropagation();
          revert();
        }
      }}
      aria-invalid={invalid || undefined}
      className={cn('field-input', invalid && 'border-danger', className)}
      {...rest}
    />
  );
}
