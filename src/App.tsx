import "./App.css";

import { useSession } from "./auth/SessionContext";
import { AuthScreen } from "./features/auth/AuthScreen";
import { MainShell } from "./features/shell/MainShell";

function App() {
  const { state } = useSession();

  switch (state.status) {
    case "restoring":
      return (
        <main className="splash" aria-busy="true">
          <span className="muted">Signing in…</span>
        </main>
      );
    case "signedOut":
      return <AuthScreen />;
    case "signedIn":
      return <MainShell user={state.user} />;
  }
}

export default App;
