import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Full-screen QR scanner, Android only (see `platform.ts`).
 *
 * `tauri-plugin-barcode-scanner` in windowed mode draws the camera *behind*
 * the WebView and makes the WebView transparent, so while this is mounted the
 * app root is hidden (`html.qr-scanning #root`, App.css) and this overlay —
 * portalled to `<body>` so it is outside the hidden root — is the only thing
 * painted: a viewfinder cut-out, a hint, and a cancel button.
 *
 * `onScan` receives the raw QR text once; the caller decides what it means.
 */
export default function QrScanner({
  hint,
  onScan,
  onCancel,
}: {
  hint: string;
  onScan: (content: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add('qr-scanning');
    let cancelled = false;

    (async () => {
      try {
        const scanner = await import('@tauri-apps/plugin-barcode-scanner');
        let perm = await scanner.checkPermissions();
        if (perm !== 'granted') perm = await scanner.requestPermissions();
        if (perm !== 'granted') {
          setError('Camera access is needed to scan a code. Allow it in Android settings and try again.');
          return;
        }
        const result = await scanner.scan({ windowed: true, formats: [scanner.Format.QRCode] });
        if (cancelled || done.current) return;
        done.current = true;
        onScan(result.content);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
      document.documentElement.classList.remove('qr-scanning');
      // Stops the camera if the user backed out before a code was read.
      import('@tauri-apps/plugin-barcode-scanner').then((s) => s.cancel()).catch(() => {});
    };
  }, [onScan]);

  return createPortal(
    // Painted over a live camera feed, so literal white is intended here:
    // there is no theme surface behind it.
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 p-6 text-center text-white">
      <div className="aspect-square w-[min(70vw,18rem)] border-[0.1875rem] border-white shadow-[0_0_0_100vmax_rgb(0_0_0/0.55)]" />
      <p className="max-w-80 text-sm leading-snug [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">{error ?? hint}</p>
      <button
        type="button"
        className="border border-white/60 bg-white/15 px-6 py-2.5 text-sm font-semibold text-white"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>,
    document.body,
  );
}
