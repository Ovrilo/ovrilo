/** Types the API accepts (POST /media/uploads). */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** Server limit (Media:Limits:ImageMaxBytes). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Still images are shrunk to this square before upload: plenty for the largest avatar, and small. */
export const STILL_IMAGE_SIZE = 512;

export type UploadPlan = { kind: "asIs" } | { kind: "shrink" } | { kind: "reject"; reason: string };

/** Animated WebP: extended header (VP8X) with the animation flag set. */
export function isAnimatedWebP(header: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...header.subarray(from, to));
  return (
    header.length >= 21 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 12) === "WEBP" &&
    ascii(12, 16) === "VP8X" &&
    (header[20]! & 0x02) !== 0
  );
}

/**
 * Animations (GIF, animated WebP) are uploaded unchanged: re-encoding them in the browser would drop
 * their frames. Still images are cropped and shrunk first. The server verifies everything again.
 */
export function planUpload(type: string, size: number, header: Uint8Array): UploadPlan {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return { kind: "reject", reason: "Use a PNG, JPEG, GIF or WebP image." };
  }
  const animated = type === "image/gif" || (type === "image/webp" && isAnimatedWebP(header));
  if (!animated) return { kind: "shrink" };
  if (size > MAX_IMAGE_BYTES) {
    return { kind: "reject", reason: `Animated images can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.` };
  }
  return { kind: "asIs" };
}

/** Centered square crop, scaled down (never up) to at most `max` pixels. */
export function squareCrop(width: number, height: number, max = STILL_IMAGE_SIZE) {
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
    size: Math.min(side, max),
  };
}

/** The file to upload and its type, ready for POST /media/uploads. */
export interface PreparedImage {
  blob: Blob;
  contentType: string;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const plan = planUpload(file.type, file.size, header);
  if (plan.kind === "reject") throw new Error(plan.reason);
  if (plan.kind === "asIs") return { blob: file, contentType: file.type };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be read.");
  }
  try {
    const crop = squareCrop(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(crop.size, crop.size);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This image could not be read.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, crop.sx, crop.sy, crop.side, crop.side, 0, 0, crop.size, crop.size);
    // WebP keeps transparency and is small; fall back to PNG where it cannot be encoded.
    const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
    const blob = webp.type === "image/webp" ? webp : await canvas.convertToBlob({ type: "image/png" });
    return { blob, contentType: blob.type };
  } finally {
    bitmap.close();
  }
}
