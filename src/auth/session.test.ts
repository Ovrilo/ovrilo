import { describe, expect, it, vi } from "vitest";

import type { Schemas } from "../api/client";
import { type CredentialStore, secondsUntilExpiry, SessionManager } from "./session";

const BASE = "http://api.test";

function memoryStore(initial: string | null = null): CredentialStore & { value: string | null } {
  const store = {
    value: initial,
    load: async () => store.value,
    store: async (token: string) => {
      store.value = token;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

function authResponse(n: number): Schemas["AuthResponse"] {
  return {
    accessToken: `access-${n}`,
    accessTokenExpiresAt: "2026-10-13T00:15:00Z",
    refreshToken: `refresh-${n}`,
    sessionExpiresAt: "2026-11-12T00:00:00Z",
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      username: "ada",
      displayName: "Ada",
      email: "ada@example.com",
      emailVerified: false,
      createdAt: "2026-10-13T00:00:00Z",
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("SessionManager", () => {
  it("restores a stored session by rotating the refresh token", async () => {
    const store = memoryStore("refresh-0");
    const send = vi.fn(async () => json(authResponse(1)));
    const session = new SessionManager(BASE, store, send);

    await session.restore();

    expect(session.getState()).toMatchObject({ status: "signedIn", user: { username: "ada" } });
    expect(store.value).toBe("refresh-1");
  });

  it("is signed out when nothing is stored", async () => {
    const send = vi.fn();
    const session = new SessionManager(BASE, memoryStore(), send);

    await session.restore();

    expect(session.getState().status).toBe("signedOut");
    expect(send).not.toHaveBeenCalled();
  });

  it("forgets credentials when the server rejects the refresh token", async () => {
    const store = memoryStore("refresh-0");
    const session = new SessionManager(BASE, store, async () => json({ code: "identity.invalid_refresh_token" }, 401));

    await session.restore();

    expect(session.getState().status).toBe("signedOut");
    expect(store.value).toBeNull();
  });

  it("keeps credentials when the network is unavailable", async () => {
    const store = memoryStore("refresh-0");
    const session = new SessionManager(BASE, store, async () => {
      throw new TypeError("network down");
    });

    await session.restore();

    expect(session.getState().status).toBe("signedOut");
    expect(store.value).toBe("refresh-0");
  });

  it("adds the bearer token and retries once after refreshing on 401", async () => {
    const store = memoryStore();
    const calls: string[] = [];
    const send = vi.fn(async (request: Request) => {
      const auth = request.headers.get("Authorization") ?? "";
      calls.push(`${new URL(request.url).pathname} ${auth}`);
      if (request.url.endsWith("/auth/refresh")) return json(authResponse(2));
      return auth === "Bearer access-1" ? json({}, 401) : json({ ok: true });
    });
    const session = new SessionManager(BASE, store, send);
    await session.signIn(authResponse(1));

    const response = await session.fetch(new Request(`${BASE}/users/me`));

    expect(response.status).toBe(200);
    expect(calls).toEqual(["/users/me Bearer access-1", "/auth/refresh ", "/users/me Bearer access-2"]);
    expect(store.value).toBe("refresh-2");
  });

  it("shares one refresh between concurrent 401s", async () => {
    let refreshes = 0;
    const send = vi.fn(async (request: Request) => {
      if (request.url.endsWith("/auth/refresh")) {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(authResponse(2));
      }
      return request.headers.get("Authorization") === "Bearer access-2" ? json({}) : json({}, 401);
    });
    const session = new SessionManager(BASE, memoryStore(), send);
    await session.signIn(authResponse(1));

    const responses = await Promise.all([1, 2, 3].map(() => session.fetch(new Request(`${BASE}/communities`))));

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshes).toBe(1);
  });

  it("does not attach tokens or retry credential endpoints", async () => {
    const send = vi.fn(async () => json({ code: "identity.invalid_credentials" }, 401));
    const session = new SessionManager(BASE, memoryStore(), send);
    await session.signIn(authResponse(1));

    const response = await session.fetch(new Request(`${BASE}/auth/login`, { method: "POST" }));

    expect(response.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [Request])[0].headers.get("Authorization")).toBeNull();
  });

  it("signs out on the server and clears local credentials", async () => {
    const store = memoryStore();
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    const session = new SessionManager(BASE, store, send);
    await session.signIn(authResponse(1));

    await session.signOut();

    const request = (send.mock.calls[0] as unknown as [Request])[0];
    expect(new URL(request.url).pathname).toBe("/auth/logout");
    expect(request.headers.get("Authorization")).toBe("Bearer access-1");
    expect(store.value).toBeNull();
    expect(session.getState().status).toBe("signedOut");
  });
});

describe("secondsUntilExpiry", () => {
  const jwt = (payload: object) =>
    ["header", btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "sig"].join(".");

  it("reads exp relative to now", () => {
    expect(secondsUntilExpiry(jwt({ exp: 1000 }), 400_000)).toBe(600);
  });

  it("treats unreadable tokens as expired", () => {
    expect(secondsUntilExpiry("not-a-jwt")).toBe(0);
    expect(secondsUntilExpiry(jwt({ sub: "x" }))).toBe(0);
  });
});
