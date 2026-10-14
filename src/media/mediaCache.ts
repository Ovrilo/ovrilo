import type { Schemas } from "../api/client";
import { isAnimatedWebP } from "./prepareImage";

/** Object URLs for one image: `src` plays animations, `still` is its first frame (the same URL for still images). */
export interface MediaImage {
  src: string;
  still: string;
  animated: boolean;
}

type DownloadUrl = Schemas["DownloadUrl"];

interface Entry {
  image?: MediaImage;
  failedAt?: number;
}

export interface MediaCacheDeps {
  /** POST /media/download-urls; omits assets the caller may not see. */
  resolveUrls: (assetIds: string[]) => Promise<DownloadUrl[]>;
  /** Reads an image straight from storage (presigned URL). */
  fetchBlob: (url: string) => Promise<Blob>;
  /** First frame of an animated image, or null when it cannot be made. */
  makeStill: (blob: Blob) => Promise<Blob | null>;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  now: () => number;
}

/** Server limit per POST /media/download-urls. */
const BATCH_SIZE = 100;
/** A failed image is not retried before this; avatars fall back to initials meanwhile. */
const RETRY_AFTER_MS = 60_000;

/**
 * Image bytes by asset ID for the signed-in session. Asset IDs never change content (a new avatar
 * is a new ID), so each image is downloaded once and kept as an object URL. Requests made in the
 * same tick are batched into one download-URL call.
 */
export class MediaCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private queue = new Set<string>();
  private flushScheduled = false;
  private generation = 0;

  constructor(private readonly deps: MediaCacheDeps) {}

  /** The loaded image, or undefined while loading, after a failure, or before `load`. */
  get = (assetId: string): MediaImage | undefined => this.entries.get(assetId)?.image;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  load(assetId: string): void {
    const entry = this.entries.get(assetId);
    if (entry?.image || this.inFlight.has(assetId) || this.queue.has(assetId)) return;
    if (entry?.failedAt !== undefined && this.deps.now() - entry.failedAt < RETRY_AFTER_MS) return;
    this.queue.add(assetId);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => void this.flush());
    }
  }

  /** Forgets everything (sign-out) and frees the object URLs. */
  clear(): void {
    this.generation++;
    for (const entry of this.entries.values()) {
      if (!entry.image) continue;
      this.deps.revokeObjectUrl(entry.image.src);
      if (entry.image.still !== entry.image.src) this.deps.revokeObjectUrl(entry.image.still);
    }
    this.entries.clear();
    this.inFlight.clear();
    this.queue.clear();
    this.notify();
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const ids = [...this.queue];
    this.queue = new Set();
    ids.forEach((id) => this.inFlight.add(id));
    const generation = this.generation;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      let urls: DownloadUrl[];
      try {
        urls = await this.deps.resolveUrls(batch);
      } catch {
        if (generation === this.generation) batch.forEach((id) => this.fail(id));
        continue;
      }
      const byId = new Map(urls.map((u) => [u.assetId, u]));
      await Promise.all(
        batch.map(async (id) => {
          const url = byId.get(id);
          if (!url) return this.fail(id);
          try {
            const image = await this.download(url);
            if (generation !== this.generation) return;
            this.inFlight.delete(id);
            this.entries.set(id, { image });
            this.notify();
          } catch {
            if (generation === this.generation) this.fail(id);
          }
        }),
      );
    }
  }

  private async download(url: DownloadUrl): Promise<MediaImage> {
    const blob = await this.deps.fetchBlob(url.url);
    const src = this.deps.createObjectUrl(blob);
    // Animated pictures get a first-frame still for when they should not play. GIFs are treated as
    // animated (single-frame ones are rare as avatars); WebP says so in its header.
    const animatable =
      url.contentType === "image/gif" ||
      (url.contentType === "image/webp" && isAnimatedWebP(new Uint8Array(await blob.slice(0, 32).arrayBuffer())));
    const stillBlob = animatable ? await this.deps.makeStill(blob).catch(() => null) : null;
    if (!stillBlob) return { src, still: src, animated: false };
    return { src, still: this.deps.createObjectUrl(stillBlob), animated: true };
  }

  private fail(assetId: string): void {
    this.inFlight.delete(assetId);
    this.entries.set(assetId, { failedAt: this.deps.now() });
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/** First frame via the browser's decoder: createImageBitmap returns frame 0 of an animation. */
export async function firstFrame(blob: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}
