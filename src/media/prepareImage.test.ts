import { describe, expect, it } from "vitest";

import { isAnimatedWebP, MAX_IMAGE_BYTES, planUpload, squareCrop } from "./prepareImage";

const bytes = (ascii: string, extra: number[] = []) => new Uint8Array([...ascii].map((c) => c.charCodeAt(0)).concat(extra));
// RIFF....WEBPVP8X + chunk size (4 bytes) + flags byte.
const webpX = (flags: number) => bytes("RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0", [flags]);

describe("planUpload", () => {
  it("uploads GIFs and animated WebP unchanged so they keep moving", () => {
    expect(planUpload("image/gif", 1000, bytes("GIF89a"))).toEqual({ kind: "asIs" });
    expect(planUpload("image/webp", 1000, webpX(0x02))).toEqual({ kind: "asIs" });
  });

  it("shrinks still images before upload", () => {
    expect(planUpload("image/png", 50 * 1024 * 1024, bytes("\x89PNG"))).toEqual({ kind: "shrink" });
    expect(planUpload("image/jpeg", 1000, bytes("\xff\xd8\xff"))).toEqual({ kind: "shrink" });
    expect(planUpload("image/webp", 1000, webpX(0x10))).toEqual({ kind: "shrink" });
  });

  it("rejects other types and animations over the size limit", () => {
    expect(planUpload("image/svg+xml", 10, bytes("<svg")).kind).toBe("reject");
    expect(planUpload("", 10, bytes("")).kind).toBe("reject");
    expect(planUpload("image/gif", MAX_IMAGE_BYTES + 1, bytes("GIF89a")).kind).toBe("reject");
  });
});

describe("isAnimatedWebP", () => {
  it("reads the animation flag of the extended header", () => {
    expect(isAnimatedWebP(webpX(0x02))).toBe(true);
    expect(isAnimatedWebP(webpX(0x00))).toBe(false);
    expect(isAnimatedWebP(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe(false);
  });
});

describe("squareCrop", () => {
  it("crops the center square and never scales up", () => {
    expect(squareCrop(1000, 600)).toEqual({ sx: 200, sy: 0, side: 600, size: 512 });
    expect(squareCrop(100, 300)).toEqual({ sx: 0, sy: 100, side: 100, size: 100 });
  });
});
