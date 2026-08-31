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

  useEffect(() => {
    const onPopState = () => setScreen(screenOfPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (next: Screen) => {
    window.history.pushState(null, "", PATH_OF[next]);
    setScreen(next);
  };

  if (session) {
    return (
      <SignedIn
        session={session}
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
