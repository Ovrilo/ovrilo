import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { useMediaImage } from "../media/useMediaImage";

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function Avatar({
  name,
  assetId = null,
  size = "md",
  speaking = false,
  muted = false,
  animate = "hover",
}: {
  name: string;
  /** Profile picture or icon; initials are shown until it has loaded, or when there is none. */
  assetId?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  /** Ring while this person talks; pair it with text for screen readers. */
  speaking?: boolean;
  /** Talking but muted for this client: the ring turns red. */
  muted?: boolean;
  /**
   * When an animated picture (GIF) plays. "hover": only while the pointer is over it or over an
   * enclosing `.avatar-hover-scope` (lists stay calm and cheap); "always": profile views, unless the
   * system asks for reduced motion.
   */
  animate?: "hover" | "always";
}) {
  const image = useMediaImage(assetId);
  const ring = speaking ? (muted ? " speaking muted" : " speaking") : "";
  const play = image?.animated && animate === "always" ? " avatar-play" : "";
  return (
    <span className={`avatar avatar-${size}${ring}${image ? " has-image" : ""}${play}`} aria-hidden="true">
      {image ? (
        <>
          {/* Hidden images are not painted, so a paused GIF costs nothing (DESIGN.md: low resource use). */}
          <img className="avatar-still" src={image.still} alt="" draggable={false} />
          {image.animated && <img className="avatar-animated" src={image.src} alt="" draggable={false} />}
        </>
      ) : (
        initials(name)
      )}
    </span>
  );
}

/**
 * A community's icon in its rounded square, or its initials. Animated icons play on hover of the
 * enclosing `.avatar-hover-scope` (the rail button), like avatars.
 */
export function CommunityIcon({ name, assetId, large = false }: { name: string; assetId: string | null; large?: boolean }) {
  const image = useMediaImage(assetId);
  return (
    <span className={`community-icon${large ? " large" : ""}${image ? " has-image" : ""}`} aria-hidden="true">
      {image ? (
        <>
          <img className="avatar-still" src={image.still} alt="" draggable={false} />
          {image.animated && <img className="avatar-animated" src={image.src} alt="" draggable={false} />}
        </>
      ) : (
        initials(name)
      )}
    </span>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  /** Accessible name; also shown as a tooltip. */
  label: string;
  tone?: "default" | "danger" | "active";
};

/** Icon-only button with an accessible label (DESIGN.md §8). */
export function IconButton({ icon: Icon, label, tone = "default", className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button tone-${tone} ${className ?? ""}`}
      {...rest}
    >
      <Icon size={18} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
