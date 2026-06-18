import type { CSSProperties } from "react";

interface SkeletonBlockProps {
  width?: string;
  height?: string;
  style?: CSSProperties;
}

/** A shimmer placeholder block — used in loading states. */
export function SkeletonBlock({ width = "100%", height = "1em", style }: SkeletonBlockProps) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ display: "block", width, height, borderRadius: "var(--radius-sm)", ...style }}
    />
  );
}
