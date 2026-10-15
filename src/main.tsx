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

// The webview's native drop handler is off (tauri.conf.json `dragDropEnabled`) so channels can be
// dragged to reorder on Windows. Refuse every drop nothing handled, or a dropped file would replace the app.
for (const type of ["dragover", "drop"] as const) {
  window.addEventListener(type, (event) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
