import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { API_BASE_URL, type ApiClient, createApiClient } from "../api/client";
import { firstFrame, MediaCache } from "../media/mediaCache";
import { RealtimeClient } from "../realtime/realtime";
import { credentialStore } from "./credentials";
import { SessionManager, type SessionState } from "./session";

interface SessionContextValue {
  session: SessionManager;
  api: ApiClient;
  realtime: RealtimeClient;
  media: MediaCache;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [value] = useState<SessionContextValue>(() => {
    const session = new SessionManager(API_BASE_URL, credentialStore);
    const api = createApiClient(session.fetch);
    return {
      session,
      api,
      realtime: new RealtimeClient(API_BASE_URL, session.getAccessToken),
      media: new MediaCache({
        resolveUrls: async (assetIds) => {
          const { data, error } = await api.POST("/media/download-urls", { body: { assetIds } });
          if (!data) throw error;
          return data.urls;
        },
        // Presigned storage URLs carry their own credentials; never send the bearer token there.
        fetchBlob: async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.blob();
        },
        makeStill: firstFrame,
        createObjectUrl: (blob) => URL.createObjectURL(blob),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        now: () => Date.now(),
      }),
    };
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    void value.session.restore();
  }, [value]);

  // Never show one account's cached data to the next account; realtime follows the session.
  useEffect(() => {
    const sync = () => {
      const status = value.session.getState().status;
      if (status === "signedIn") value.realtime.start();
      if (status === "signedOut") {
        void value.realtime.stop();
        queryClient.clear();
        value.media.clear();
      }
    };
    sync();
    return value.session.subscribe(sync);
  }, [value, queryClient]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function useSessionContext(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is missing");
  return context;
}

/** The realtime (SignalR) connection of the current session. */
export function useRealtime(): RealtimeClient {
  return useSessionContext().realtime;
}

/** Images (avatars, icons) of the current session, by asset ID. */
export function useMedia(): MediaCache {
  return useSessionContext().media;
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
