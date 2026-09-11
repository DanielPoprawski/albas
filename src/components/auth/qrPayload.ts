/**
 * What an Albas sign-in QR encodes, and how to read one back.
 *
 * Both directions encode the portal's login URL so a plain camera app still
 * lands somewhere sensible:
 *  - `?app_session=<nonce>` — a *pending* session: the device showing the QR
 *    is signed out and wants a signed-in device to approve it.
 *  - `?linked=<nonce>` — an *offered* session: the device showing the QR is
 *    signed in and has already claimed it; the scanner polls and adopts.
 */
export type QrPayload = { kind: 'pending'; nonce: string } | { kind: 'offered'; nonce: string } | null;

const NONCE = /^[0-9a-f]{16,128}$/i;

export function parseQrPayload(text: string): QrPayload {
  let params: URLSearchParams;
  try {
    params = new URL(text.trim()).searchParams;
  } catch {
    return null;
  }
  const pending = params.get('app_session');
  if (pending && NONCE.test(pending)) return { kind: 'pending', nonce: pending };
  const offered = params.get('linked');
  if (offered && NONCE.test(offered)) return { kind: 'offered', nonce: offered };
  return null;
}
