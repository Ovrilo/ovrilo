import { type ApiClient, type Schemas } from "../api/client";
import { prepareImage } from "./prepareImage";

type Purpose = Schemas["MediaPurpose"];

/**
 * Uploads an image straight to storage (ADR-0014): the API hands out a short-lived URL, the file is
 * PUT there, then the API verifies it. Returns the verified asset ID; throws an Error (or the API's
 * problem) with a message to show.
 */
export async function uploadImage(
  api: ApiClient,
  file: File,
  purpose: Purpose,
  communityId: string | null = null,
): Promise<string> {
  const { blob, contentType } = await prepareImage(file);

  const started = await api.POST("/media/uploads", {
    body: { purpose, contentType, sizeBytes: blob.size, filename: file.name, communityId },
  });
  if (!started.data) throw started.error;

  // Storage, not the API: no bearer token. The signature fixes the content type.
  const put = await fetch(started.data.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob }).catch(
    () => null,
  );
  if (!put?.ok) throw new Error("The upload failed. Check your connection and try again.");

  const completed = await api.POST("/media/uploads/{assetId}/complete", {
    params: { path: { assetId: started.data.assetId } },
  });
  if (!completed.data) throw completed.error;
  return completed.data.id;
}
