import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

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
  size = "md",
  speaking = false,
  muted = false,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** Ring while this person talks; pair it with text for screen readers. */
  speaking?: boolean;
  /** Talking but muted for this client: the ring turns red. */
  muted?: boolean;
}) {
  const ring = speaking ? (muted ? " speaking muted" : " speaking") : "";
  return (
    <span className={`avatar avatar-${size}${ring}`} aria-hidden="true">
      {initials(name)}
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
