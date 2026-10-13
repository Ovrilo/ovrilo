import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { API_BASE_URL, type ApiClient, createApiClient } from "../api/client";
import { credentialStore } from "./credentials";
import { SessionManager, type SessionState } from "./session";

interface SessionContextValue {
  session: SessionManager;
  api: ApiClient;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [value] = useState<SessionContextValue>(() => {
    const session = new SessionManager(API_BASE_URL, credentialStore);
    return { session, api: createApiClient(session.fetch) };
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    void value.session.restore();
  }, [value]);

  // Never show one account's cached data to the next account.
  useEffect(
    () =>
      value.session.subscribe(() => {
        if (value.session.getState().status === "signedOut") queryClient.clear();
      }),
    [value, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function useSessionContext(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is missing");
  return context;
}

/** Typed API client bound to the current session. */
export function useApi(): ApiClient {
  return useSessionContext().api;
}

export function useSession(): { state: SessionState; session: SessionManager } {
  const { session } = useSessionContext();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return { state, session };
}
