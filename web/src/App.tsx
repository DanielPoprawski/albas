import { useEffect, useState } from 'react';
import './index.css';
import { claimGoogleTicket, getSession, saveSession, type Session } from './lib/api';
import { PATH_OF, screenOfPath, type Screen } from './screens';
import { Splash } from './components/auth/Splash';
import { LoginScreen } from './components/auth/LoginScreen';
import { RegisterForm } from './components/auth/RegisterForm';
import { OfflineInfo } from './components/auth/OfflineInfo';
import { SignedIn } from './components/auth/SignedIn';

/**
 * Reads a param from the URL *fragment* first — `src-tauri/src/account.rs`
 * and `sync-server/src/google.rs` both hand this page `#app_session=<nonce>`
 * / `#linked=<nonce>` rather than a query param, because a fragment is never
 * sent in an HTTP request (not to this server, not logged anywhere) — see
 * CLAUDE.md, "Auth". Falls back to the query string for one release, since
 * links minted by an older server/app build still use `?app_session=`; drop
 * the fallback once those are out of circulation.
 */
function paramFromHashOrQuery(name: string): string | null {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const fromHash = new URLSearchParams(hash).get(name);
  if (fromHash !== null) return fromHash;
  return new URLSearchParams(window.location.search).get(name);
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() => screenOfPath(window.location.pathname));
  const [session, setSession] = useState<Session | null>(() => getSession());
  // Captured once at mount: the app opens this page with #app_session=<nonce>
  // and then polls for the result. Read from the initial URL rather than on
  // each render so an in-page navigation can never lose it.
  const [appSession] = useState<string | null>(() => paramFromHashOrQuery('app_session'));
  // A "link another device" QR opened by a camera app instead of by the Albas
  // app. The nonce in it is useless to a browser (the session is already
  // claimed for the app that showed it), so only the fact is kept.
  const [linked] = useState<boolean>(() => paramFromHashOrQuery('linked') !== null);
  // Present only right after `sync-server`'s Google callback redirects back
  // here (see `lib/api.ts`'s `claimGoogleTicket`) — a one-time pickup of the
  // session it minted, never the bearer token itself sitting in the URL.
  const [googleTicket] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('google_ticket'),
  );

  useEffect(() => {
    const onPopState = () => setScreen(screenOfPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!googleTicket) return;
    let cancelled = false;
    claimGoogleTicket(googleTicket)
      .then((claimed) => {
        if (cancelled) return;
        saveSession(claimed);
        setSession(claimed);
      })
      .catch(() => {
        // Expired, already collected, or bogus — nothing to recover here;
        // the "Continue with Google" button is still right there to retry.
      })
      .finally(() => {
        if (cancelled) return;
        // Drop the ticket from the URL either way (single-use, so keeping it
        // around is only ever misleading) but keep app_session — SignedIn
        // still needs it to claim the app-session handoff, and it now rides
        // in the fragment (see `paramFromHashOrQuery`), which this rewrite
        // must carry over explicitly since it isn't part of `search`.
        const params = new URLSearchParams(window.location.search);
        params.delete('google_ticket');
        const qs = params.toString();
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [googleTicket]);

  const navigate = (next: Screen) => {
    // Keep the query string *and* the fragment: PATH_OF alone would drop
    // ?app_session/#app_session on the way from the splash to /login,
    // stranding the app that opened this page.
    window.history.pushState(null, '', `${PATH_OF[next]}${window.location.search}${window.location.hash}`);
    setScreen(next);
  };

  if (session) {
    return (
      <SignedIn
        session={session}
        appSession={appSession}
        onSignedOut={() => {
          setSession(null);
          navigate('splash');
        }}
      />
    );
  }

  switch (screen) {
    case 'login':
      return <LoginScreen onNavigate={navigate} onSignedIn={setSession} appSession={appSession} linked={linked} />;
    case 'register':
      return <RegisterForm onNavigate={navigate} onSignedIn={setSession} appSession={appSession} />;
    case 'offline':
      return <OfflineInfo onNavigate={navigate} />;
    default:
      return <Splash onNavigate={navigate} />;
  }
}
