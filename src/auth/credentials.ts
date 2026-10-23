import { invoke, isTauri } from "@tauri-apps/api/core";

import type { CredentialStore } from "./session";

/** OS credential store via the Rust host (src-tauri/src/credentials.rs). */
const osCredentialStore: CredentialStore = {
  load: () => invoke<string | null>("credentials_load_refresh_token"),
  store: (token) => invoke("credentials_store_refresh_token", { token }),
  clear: () => invoke("credentials_clear_refresh_token"),
};

/**
 * Browser client (ADR-0019): the API keeps the refresh token in an HttpOnly cookie that scripts cannot read, so
 * nothing is stored here and nothing goes to web storage.
 */
const cookieCredentialStore: CredentialStore = {
  cookie: true,
  load: async () => null,
  store: async () => undefined,
  clear: async () => undefined,
};

export const credentialStore: CredentialStore = isTauri() ? osCredentialStore : cookieCredentialStore;
