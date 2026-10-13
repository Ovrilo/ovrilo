import { type FormEvent, useState } from "react";

import { problemMessage } from "../../api/client";
import { useApi, useSession } from "../../auth/SessionContext";

type Mode = "login" | "register";

const DEVICE_LABEL = "Ovrilo Desktop (Windows)";

export function AuthScreen() {
  const api = useApi();
  const { session } = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await api.POST("/auth/login", {
              body: { login: field("login"), password: field("password"), deviceLabel: DEVICE_LABEL },
            })
          : await api.POST("/auth/register", {
              body: {
                username: field("username"),
                displayName: field("displayName"),
                email: field("email"),
                password: field("password"),
                deviceLabel: DEVICE_LABEL,
              },
            });
      if (result.data) {
        await session.signIn(result.data);
      } else {
        setError(problemMessage(result.error));
      }
    } catch {
      setError("Cannot reach the Ovrilo server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit} aria-busy={busy}>
        <h1>Ovrilo</h1>
        <div className="segmented" role="tablist" aria-label="Account">
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchMode("login")}>
            Sign in
          </button>
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => switchMode("register")}>
            Create account
          </button>
        </div>

        {mode === "login" ? (
          <label>
            Username or email
            <input name="login" autoComplete="username" required autoFocus />
          </label>
        ) : (
          <>
            <label>
              Username
              <input name="username" autoComplete="username" required minLength={3} maxLength={32} autoFocus />
            </label>
            <label>
              Display name
              <input name="displayName" autoComplete="nickname" required maxLength={80} />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={320} />
            </label>
          </>
        )}
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={8}
            maxLength={128}
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
    </main>
  );
}
