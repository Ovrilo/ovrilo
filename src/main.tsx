import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { SessionProvider } from "./auth/SessionContext";

const queryClient = new QueryClient({
  defaultOptions: {
    // Avoid background polling while gaming; data refreshes on explicit actions and window focus.
    queries: { staleTime: 30_000, retry: 1, refetchOnReconnect: true },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
