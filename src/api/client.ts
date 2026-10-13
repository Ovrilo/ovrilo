import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

/** Wire types generated from api/ovrilo-api.json. Never hand-copy API DTOs. */
export type Schemas = components["schemas"];

export const API_BASE_URL: string = import.meta.env.VITE_OVRILO_API_URL ?? "http://localhost:5158";

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(fetchImpl: (request: Request) => Promise<Response>) {
  return createClient<paths>({ baseUrl: API_BASE_URL, fetch: fetchImpl });
}

/** Problem Details (RFC 9457) with the API's stable `code` extension. */
export interface Problem {
  status?: number;
  title?: string;
  code?: string;
  errors?: Record<string, string[]>;
}

/** Human-readable message for a failed API call; prefers field validation messages. */
export function problemMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error && typeof error === "object") {
    const problem = error as Problem;
    const firstFieldError = problem.errors ? Object.values(problem.errors).flat()[0] : undefined;
    return firstFieldError ?? problem.title ?? fallback;
  }
  return fallback;
}
