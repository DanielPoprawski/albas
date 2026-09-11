import { inTauri } from './persistence';

/**
 * Whether this is the Android build. The QR *scanner* only exists there
 * (`tauri-plugin-barcode-scanner` is mobile-only and a desktop rarely has a
 * camera pointed at anything), so the buttons that open it are gated on this.
 * The user agent is good enough: inside the Tauri WebView on Android it always
 * carries "Android", and the check is never security-relevant.
 */
export function isAndroid(): boolean {
  return inTauri() && /Android/i.test(navigator.userAgent);
}
