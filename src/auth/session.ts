import type { Schemas } from "../api/client";

/** Where the refresh token lives. The desktop implementation is the OS credential store (see credentials.ts). */
export interface CredentialStore {
  load(): Promise<string | null>;
  store(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export type SessionState =
  | { status: "restoring" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: Schemas["CurrentUserResponse"] };

/**
 * Owns the signed-in session (ADR-0011, ADR-0012):
 * - access token in memory only; refresh token only in the credential store,
 * - one refresh in flight at a time (the API revokes the session if a rotated token is replayed),
 * - API calls get a bearer token and are retried once after a refresh on 401.
 */
export class SessionManager {
  private state: SessionState = { status: "restoring" };
  private accessToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly baseUrl: string,
    private readonly credentials: CredentialStore,
    private readonly send: (request: Request) => Promise<Response> = (request) => fetch(request),
  ) {}

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Restores a previous session from the credential store, if any. */
  async restore(): Promise<void> {
    const refreshToken = await this.credentials.load().catch(() => null);
    if (!refreshToken) {
      this.setState({ status: "signedOut" });
      return;
    }
    if (!(await this.refresh())) {
      this.setState({ status: "signedOut" });
    }
  }

  /** Completes sign-in/registration with the API's token response. */
  async signIn(auth: Schemas["AuthResponse"]): Promise<void> {
    await this.credentials.store(auth.refreshToken);
    this.accessToken = auth.accessToken;
    this.setState({ status: "signedIn", user: auth.user });
  }

  /** Replaces the signed-in account's data after a profile change (for example a new avatar). */
  updateUser(user: Schemas["CurrentUserResponse"]): void {
    if (this.state.status !== "signedIn" || this.state.user.id !== user.id) return;
    this.setState({ status: "signedIn", user });
  }

  /** Revokes the session on the server (best effort) and forgets local credentials. */
  async signOut(): Promise<void> {
    if (this.accessToken) {
      await this.send(this.authorized(new Request(`${this.baseUrl}/auth/logout`, { method: "POST" }), this.accessToken)).catch(
        () => undefined,
      );
    }
    await this.forget();
  }

  /** fetch for the generated API client: adds the bearer token and recovers once from an expired access token. */
  fetch = async (request: Request): Promise<Response> => {
    const isAuthEndpoint = new URL(request.url).pathname.startsWith("/auth/") && !request.url.endsWith("/auth/logout");
    const token = this.accessToken;
    if (isAuthEndpoint || !token) {
      return this.send(request);
    }

    const retry = request.clone();
    const response = await this.send(this.authorized(request, token));
    if (response.status !== 401) {
      return response;
    }

    // Another request may already have refreshed while this one was in flight.
    if ((this.accessToken !== token && this.accessToken) || (await this.refresh())) {
      return this.send(this.authorized(retry, this.accessToken!));
    }
    return response;
  };

  /**
   * An access token valid for at least another minute, refreshing first if needed (for connections
   * that cannot retry a 401 the way `fetch` does, such as the realtime hub). Null when signed out.
   */
  getAccessToken = async (): Promise<string | null> => {
    if (this.accessToken && secondsUntilExpiry(this.accessToken) > 60) return this.accessToken;
    return (await this.refresh()) ? this.accessToken : null;
  };

  /** Rotates the refresh token. Concurrent callers share one request. Returns false when signed out. */
  refresh(): Promise<boolean> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = await this.credentials.load().catch(() => null);
    if (!refreshToken) {
      await this.forget();
      return false;
    }

    let response: Response;
    try {
      response = await this.send(
        new Request(`${this.baseUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        }),
      );
    } catch {
      // Network failure: keep the stored token so a later attempt can succeed.
      return false;
    }

    if (response.ok) {
      await this.signIn((await response.json()) as Schemas["AuthResponse"]);
      return true;
    }
    if (response.status === 401 || response.status === 403) {
      await this.forget();
    }
    return false;
  }

  private async forget(): Promise<void> {
    this.accessToken = null;
    await this.credentials.clear().catch(() => undefined);
    this.setState({ status: "signedOut" });
  }

  private authorized(request: Request, token: string): Request {
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return new Request(request, { headers });
  }

  private setState(state: SessionState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

/** Seconds until a JWT's `exp`; 0 when it cannot be read (treated as expired). */
export function secondsUntilExpiry(jwt: string, nowMs = Date.now()): number {
  try {
    const payload = jwt.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp - nowMs / 1000 : 0;
  } catch {
    return 0;
  }
}
