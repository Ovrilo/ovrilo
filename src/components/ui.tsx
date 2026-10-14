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
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** Green ring while this person talks; pair it with text for screen readers. */
  speaking?: boolean;
}) {
  return (
    <span className={`avatar avatar-${size}${speaking ? " speaking" : ""}`} aria-hidden="true">
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
