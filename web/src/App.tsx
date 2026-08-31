import { useEffect, useState } from "react";
import "./index.css";
import { getSession, type Session } from "./lib/api";
import { PATH_OF, screenOfPath, type Screen } from "./screens";
import { Splash } from "./components/auth/Splash";
import { LoginScreen } from "./components/auth/LoginScreen";
import { RegisterForm } from "./components/auth/RegisterForm";
import { OfflineInfo } from "./components/auth/OfflineInfo";
import { SignedIn } from "./components/auth/SignedIn";

export function App() {
  const [screen, setScreen] = useState<Screen>(() => screenOfPath(window.location.pathname));
  const [session, setSession] = useState<Session | null>(() => getSession());
  // Captured once at mount: the app opens this page with ?app_session=<nonce>
  // and then polls for the result. Read from the initial URL rather than on
  // each render so an in-page navigation can never lose it.
  const [appSession] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("app_session"),
  );

  useEffect(() => {
    const onPopState = () => setScreen(screenOfPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (next: Screen) => {
    // Keep the query string: PATH_OF alone would drop ?app_session on the way
    // from the splash to /login, stranding the app that opened this page.
    window.history.pushState(null, "", `${PATH_OF[next]}${window.location.search}`);
    setScreen(next);
  };

  if (session) {
    return (
      <SignedIn
        session={session}
        appSession={appSession}
        onSignedOut={() => {
          setSession(null);
          navigate("splash");
        }}
      />
    );
  }

  switch (screen) {
    case "login":
      return <LoginScreen onNavigate={navigate} onSignedIn={setSession} />;
    case "register":
      return <RegisterForm onNavigate={navigate} onSignedIn={setSession} />;
    case "offline":
      return <OfflineInfo onNavigate={navigate} />;
    default:
      return <Splash onNavigate={navigate} />;
  }
}

export default App;
