/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of ovrilo-api. Defaults to the local development API. */
  readonly VITE_OVRILO_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
