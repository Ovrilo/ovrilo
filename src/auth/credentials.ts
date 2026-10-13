import { invoke, isTauri } from "@tauri-apps/api/core";

import type { CredentialStore } from "./session";

/** OS credential store via the Rust host (src-tauri/src/credentials.rs). */
const osCredentialStore: CredentialStore = {
  load: () => invoke<string | null>("credentials_load_refresh_token"),
  store: (token) => invoke("credentials_store_refresh_token", { token }),
  clear: () => invoke("credentials_clear_refresh_token"),
};

/** Plain-browser development only (`pnpm dev`): memory, never web storage; sessions end on reload. */
function memoryCredentialStore(): CredentialStore {
  let token: string | null = null;
  return {
    load: async () => token,
    store: async (value) => {
      token = value;
    },
    clear: async () => {
      token = null;
    },
  };
}

export const credentialStore: CredentialStore = isTauri() ? osCredentialStore : memoryCredentialStore();
