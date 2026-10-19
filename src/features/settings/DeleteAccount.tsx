import { type FormEvent, useState } from "react";

import { problemMessage } from "../../api/client";
import { useApi, useSession } from "../../auth/SessionContext";
import { voice } from "../voice/voice";

/** Delete your account after confirming with your password; signs out when done. */
export function DeleteAccount() {
  const api = useApi();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setBusy(true);
    setError(null);
    const { error: problem, response } = await api.POST("/users/me/delete", { body: { password } });
    if (!response.ok) {
      setBusy(false);
      setError(problemMessage(problem, "The account could not be deleted. Please try again."));
      return;
    }
    // The account and its sessions are gone: leave voice and forget the credentials here too.
    void voice.leave();
    await session.signOut();
  };

  if (!open) {
    return (
      <section className="settings-group delete-account" aria-labelledby="delete-account-title">
        <h3 id="delete-account-title">Delete account</h3>
        <p className="muted small">Removes your account for good. Communities you own must be deleted first.</p>
        <button className="danger ghost" onClick={() => setOpen(true)}>
          Delete account…
        </button>
      </section>
    );
  }

  return (
    <section className="settings-group delete-account" aria-labelledby="delete-account-title">
      <h3 id="delete-account-title">Delete your account?</h3>
      <ul className="delete-account-list">
        <li>You are signed out everywhere and cannot sign in again.</li>
        <li>Your friends, friend requests and blocks are removed, and you leave your communities and group chats.</li>
        <li>Your messages stay, shown as from “Deleted user”.</li>
        <li>Your username and email can be used for a new account.</li>
      </ul>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" autoFocus />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="danger" disabled={busy}>
            {busy ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </form>
    </section>
  );
}
