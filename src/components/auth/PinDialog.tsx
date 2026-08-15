import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { inputClass } from '../forms/shared';

/**
 * A security key waiting for its PIN (Linux — Windows and Android prompt
 * natively). Dismissing it cancels the whole ceremony rather than leaving the
 * key blinking forever.
 */
export default function PinDialog({
  attemptsRemaining,
  onSubmit,
  onCancel,
}: {
  attemptsRemaining: number | null;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');

  function submit() {
    if (!pin) return;
    onSubmit(pin);
    setPin('');
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onCancel(); }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-w-[min(20rem,calc(100%-2rem))]"
      >
        <DialogTitle className="text-headline-lg-mobile font-title font-normal text-txt">
          Security key PIN
        </DialogTitle>
        <p className="text-body-sm text-txt-muted">
          Your security key is asking for its PIN.
          {attemptsRemaining != null && (
            <span className="text-danger font-semibold"> Wrong PIN — {attemptsRemaining} tries left.</span>
          )}
        </p>
        <input
          className={inputClass}
          type="password"
          autoFocus
          autoComplete="off"
          inputMode="numeric"
          value={pin}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <div className="flex gap-sm justify-end">
          <button
            onClick={onCancel}
            className="px-md py-xs rounded-lg font-semibold text-body-sm text-txt-muted border border-line hover:bg-fill-strong transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!pin}
            className="px-md py-xs bg-primary text-on-primary rounded-lg font-semibold text-body-sm hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            Unlock
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
