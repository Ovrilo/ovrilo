import { describe, expect, it, vi } from "vitest";

import { MediaCache, type MediaCacheDeps } from "./mediaCache";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<MediaCacheDeps> = {}) {
  let urlCount = 0;
  const revoked: string[] = [];
  let now = 0;
  const deps: MediaCacheDeps = {
    resolveUrls: vi.fn(async (ids: string[]) =>
      ids
        .filter((id) => !id.startsWith("hidden"))
        .map((id) => ({
          assetId: id,
          url: `https://media.test/${id}`,
          contentType: id.startsWith("gif") ? "image/gif" : id.startsWith("webp") ? "image/webp" : "image/png",
          expiresAt: "2026-10-14T00:15:00Z",
        })),
    ),
    fetchBlob: vi.fn(async (url: string) => new Blob([url])),
    makeStill: vi.fn(async () => new Blob(["still"])),
    createObjectUrl: () => `blob:${++urlCount}`,
    revokeObjectUrl: (url) => revoked.push(url),
    now: () => now,
    ...overrides,
  };
  return { cache: new MediaCache(deps), deps, revoked, advance: (ms: number) => (now += ms) };
}

describe("MediaCache", () => {
  it("batches requests made together into one download-URL call", async () => {
    const { cache, deps } = setup();

    cache.load("a");
    cache.load("b");
    cache.load("a");
    await tick();

    expect(deps.resolveUrls).toHaveBeenCalledTimes(1);
    expect(deps.resolveUrls).toHaveBeenCalledWith(["a", "b"]);
    expect(cache.get("a")).toEqual({ src: "blob:1", still: "blob:1", animated: false });
    expect(cache.get("b")?.animated).toBe(false);
  });

  it("downloads each image once", async () => {
    const { cache, deps } = setup();
    cache.load("a");
    await tick();

    cache.load("a");
    await tick();

    expect(deps.fetchBlob).toHaveBeenCalledTimes(1);
  });

  it("keeps a first-frame still for GIFs and animated WebP only", async () => {
    const animatedWebP = new Uint8Array([..."RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0"].map((c) => c.charCodeAt(0)).concat([0x02]));
    const { cache, deps } = setup({
      fetchBlob: async (url) => new Blob([url.includes("webp-animated") ? animatedWebP : url]),
    });
    cache.load("gif-1");
    cache.load("png-1");
    cache.load("webp-still");
    cache.load("webp-animated");
    await tick();

    expect(cache.get("webp-still")?.animated).toBe(false);
    expect(cache.get("webp-animated")?.animated).toBe(true);

    expect(cache.get("gif-1")).toEqual({ src: expect.any(String), still: expect.any(String), animated: true });
    expect(cache.get("gif-1")!.still).not.toBe(cache.get("gif-1")!.src);
    expect(deps.makeStill).toHaveBeenCalledTimes(2);
  });

  it("shows the animation as its own still when no frame can be extracted", async () => {
    const { cache } = setup({ makeStill: async () => null });
    cache.load("gif-1");
    await tick();

    expect(cache.get("gif-1")?.animated).toBe(false);
  });

  it("does not retry hidden or failed images right away", async () => {
    const { cache, deps, advance } = setup();
    cache.load("hidden-1");
    await tick();
    cache.load("hidden-1");
    await tick();

    expect(cache.get("hidden-1")).toBeUndefined();
    expect(deps.resolveUrls).toHaveBeenCalledTimes(1);

    advance(61_000);
    cache.load("hidden-1");
    await tick();
    expect(deps.resolveUrls).toHaveBeenCalledTimes(2);
  });

  it("notifies subscribers and frees object URLs on clear", async () => {
    const { cache, revoked } = setup();
    const listener = vi.fn();
    cache.subscribe(listener);
    cache.load("gif-1");
    await tick();
    expect(listener).toHaveBeenCalled();

    cache.clear();

    expect(cache.get("gif-1")).toBeUndefined();
    expect(revoked).toHaveLength(2);
  });

  it("drops downloads that finish after a sign-out", async () => {
    let release!: () => void;
    const { cache } = setup({ fetchBlob: () => new Promise((resolve) => (release = () => resolve(new Blob(["x"])))) });
    cache.load("a");
    await tick();

    cache.clear();
    release();
    await tick();

    expect(cache.get("a")).toBeUndefined();
  });
});
