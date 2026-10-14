import { ImageUp, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { problemMessage } from "../api/client";
import { ACCEPTED_IMAGE_TYPES } from "../media/prepareImage";

/**
 * Choose, replace or remove a picture (avatar, community icon). `onUpload` does the upload and
 * saves the result; errors are shown under the buttons.
 */
export function PicturePicker({
  preview,
  hasPicture,
  onUpload,
  onRemove,
  hint,
}: {
  preview: ReactNode;
  hasPicture: boolean;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "upload" | "remove", action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(problemMessage(e, e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="picture-picker">
      {preview}
      <div className="picture-picker-body">
        <div className="picture-picker-actions">
          <button className="with-icon" disabled={busy !== null} onClick={() => input.current?.click()}>
            <ImageUp size={14} aria-hidden="true" />
            {busy === "upload" ? "Uploading…" : hasPicture ? "Change picture" : "Upload picture"}
          </button>
          {hasPicture && (
            <button className="ghost with-icon" disabled={busy !== null} onClick={() => void run("remove", onRemove)}>
              <Trash2 size={14} aria-hidden="true" />
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
        <p className="muted small">{hint}</p>
        {error && (
          <p className="form-error small" role="alert">
            {error}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Allow choosing the same file again after an error.
          event.currentTarget.value = "";
          if (file) void run("upload", () => onUpload(file));
        }}
      />
    </div>
  );
}
