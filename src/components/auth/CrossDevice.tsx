import { errorMessage } from '@/lib/utils';
import { useCallback, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { isAndroid } from '../../persistence';
import QrScanner, { parseQrPayload } from './QrScanner';
import type { useBrowserSignIn } from './signInHooks';
import * as ipc from '../../ipc';
import type { AppSessionApproval, AppSessionOffer } from '../../ipc';
import { FormMessage } from '../ui/field';

/**
 * Cross-device sign-in, both directions, on top of the browser handoff's
 * `app_sessions` (see `account.rs`, "Cross-device sign-in"). The phone is
 * always the one holding the camera:
 *
 *  - **This device is signed out** (`SignedOutPanel`): show a QR of the same
 *    login URL the browser flow uses, and a signed-in phone approves it. On a
 *    phone, the alternative is to *scan* a QR from a signed-in device instead.
 *  - **This device is signed in** (`SignedInPanel`): offer a QR a signed-out
 *    phone can scan to join this account, or — on a phone — scan a signed-out
 *    device's QR to approve it.
 */
type Browser = ReturnType<typeof useBrowserSignIn>;

const LINK = 'text-sm text-accent font-semibold cursor-pointer hover:underline disabled:opacity-40';

export function SignedOutPanel({ browser, busy }: { browser: Browser; busy: boolean }) {
  const [showQr, setShowQr] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const st = browser.state;

  const onScan = useCallback(
    (text: string) => {
      setScanning(false);
      const payload = parseQrPayload(text);
      if (payload?.kind === 'offered') {
        setScanError(null);
        void browser.attach(payload.nonce);
      } else if (payload?.kind === 'pending') {
        setScanError(
          "That code is from a device that is also signed out. Show this phone's code there instead, or sign in here first.",
        );
      } else {
        setScanError("That isn't an Albas sign-in code.");
      }
    },
    [browser],
  );

  if (st.kind === 'waiting' && showQr && st.url) {
    return (
      <div className="flex flex-col items-center gap-[0.75rem] text-center">
        <QRCodeSVG value={st.url} size={176} includeMargin />
        <p className="text-sm text-ink-secondary leading-snug">
          On a phone that's signed in, open Settings → Session → <strong>Scan to sign in another device</strong>. It
          should show the code <strong className="tracking-[0.2em]">{st.code}</strong>.
        </p>
        <button
          type="button"
          className={LINK}
          onClick={() => {
            setShowQr(false);
            void browser.cancel();
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (st.kind === 'waiting' && !showQr) {
    return (
      <div className="text-center">
        <p className="text-sm text-ink-secondary leading-snug">
          {st.code ? (
            <>
              Finish in your browser — it should show the code <strong className="tracking-[0.2em]">{st.code}</strong>.
            </>
          ) : (
            'Waiting for the other device…'
          )}
        </p>
        <button type="button" className={`${LINK} mt-[0.5rem]`} onClick={() => void browser.cancel()}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-[0.5rem]">
      <button type="button" className={LINK} disabled={busy} onClick={() => void browser.start('login')}>
        More sign-in options (passkey, Google)
      </button>
      {isAndroid() ? (
        <button
          type="button"
          className={LINK}
          disabled={busy}
          onClick={() => {
            setScanError(null);
            setScanning(true);
          }}
        >
          Scan a code from a signed-in device
        </button>
      ) : (
        <button
          type="button"
          className={LINK}
          disabled={busy}
          onClick={() => {
            setShowQr(true);
            void browser.start('login', false);
          }}
        >
          Sign in with your phone
        </button>
      )}
      {st.kind === 'starting' && <p className="text-sm text-ink-muted">Starting…</p>}
      {st.kind === 'error' && <p className="text-sm text-danger text-center">{st.message}</p>}
      {scanError && <p className="text-sm text-danger text-center">{scanError}</p>}
      {scanning && (
        <QrScanner
          hint="Point the camera at the code shown on the signed-in device (Settings → Session → Link another device)."
          onScan={onScan}
          onCancel={() => setScanning(false)}
        />
      )}
    </div>
  );
}

export function SignedInPanel() {
  const [offer, setOffer] = useState<AppSessionOffer | null>(null);
  const [approval, setApproval] = useState<AppSessionApproval | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startOffer() {
    setBusy(true);
    setError(null);
    setApproval(null);
    try {
      setOffer(await ipc.appSessionOffer());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const onScan = useCallback(async (text: string) => {
    setScanning(false);
    const payload = parseQrPayload(text);
    if (payload?.kind !== 'pending') {
      setError(
        payload
          ? 'That code is from a signed-in device — it needs a signed-out one to scan it.'
          : "That isn't an Albas sign-in code.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setApproval(await ipc.appSessionClaim(payload.nonce));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="setting-item items-start">
      <div className="flex-1">
        <div className="setting-label">Other devices</div>
        <div className="setting-desc">
          {isAndroid()
            ? 'Approve a sign-in on your desktop by scanning its code, or show a code for another phone to scan.'
            : 'Show a code for your phone to scan and it joins this account — no password typing on a small keyboard.'}
        </div>
        {offer && (
          <div className="flex flex-col items-start gap-[0.5rem] mt-3">
            <QRCodeSVG value={offer.url} size={176} includeMargin />
            <p className="setting-desc mt-0">
              On the signed-out device choose <strong>Scan a code from a signed-in device</strong>. Valid for five
              minutes, once. Confirmation code <strong className="tracking-[0.2em]">{offer.code}</strong>.
            </p>
            <button type="button" className="button-small" onClick={() => setOffer(null)}>
              Done
            </button>
          </div>
        )}
        {approval && (
          <FormMessage kind="success">
            Approved. The other device should show the code <strong>{approval.code}</strong> and is now signed in as{' '}
            {approval.account}.
          </FormMessage>
        )}
        {error && <FormMessage>{error}</FormMessage>}
      </div>
      <div className="flex flex-col gap-[0.5rem] items-end">
        {isAndroid() && (
          <button
            type="button"
            className="button-small"
            disabled={busy}
            onClick={() => {
              setError(null);
              setScanning(true);
            }}
          >
            Scan to sign in another device
          </button>
        )}
        {!offer && (
          <button type="button" className="button-small" disabled={busy} onClick={() => void startOffer()}>
            Link another device
          </button>
        )}
      </div>
      {scanning && (
        <QrScanner
          hint="Point the camera at the sign-in code on the other device."
          onScan={(text) => void onScan(text)}
          onCancel={() => setScanning(false)}
        />
      )}
    </div>
  );
}
