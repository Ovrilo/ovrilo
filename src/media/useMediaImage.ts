import { useEffect, useSyncExternalStore } from "react";

import { useMedia } from "../auth/SessionContext";
import type { MediaImage } from "./mediaCache";

/** The image of an asset once it is downloaded; undefined meanwhile (show initials) or when there is none. */
export function useMediaImage(assetId: string | null | undefined): MediaImage | undefined {
  const media = useMedia();
  useEffect(() => {
    if (assetId) media.load(assetId);
  }, [media, assetId]);
  return useSyncExternalStore(media.subscribe, () => (assetId ? media.get(assetId) : undefined));
}
