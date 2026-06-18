"use client";

import type { ReactNode, ButtonHTMLAttributes, CSSProperties } from "react";

type ButtonVariant = "primary" | "secondary" | "cyan";

type ButtonProps = {
  variant?: ButtonVariant;
  loading?: boolean;
  /** Rendered inside the button before the label. */
  leadingIcon?: ReactNode;
  size?: "sm" | "md";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size">;

/**
 * Button component — implements all states from DESIGN.md §6.11.
 *
 * Accessibility:
 * - Minimum 44×44px touch target via min-height + padding.
 * - aria-busy on loading state.
 * - disabled attribute prevents interaction.
 * - Focus ring via global :focus-visible (--shadow-focus).
 */
export function Button({
  variant = "primary",
  loading = false,
  leadingIcon,
  size = "md",
  children,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = props.disabled || loading;

  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-2)",
    fontFamily: "var(--font-body)",
    fontSize: "var(--text-sm)",
    fontWeight: "var(--weight-semibold)",
    borderRadius: "var(--radius-md)",
    cursor: isDisabled ? "not-allowed" : "pointer",
    opacity: isDisabled && !loading ? 0.4 : 1,
    transition:
      "background var(--duration-fast) var(--ease-out-expo), box-shadow var(--duration-fast) var(--ease-out-expo)",
    border: "1px solid",
    textDecoration: "none",
    whiteSpace: "nowrap",
    minHeight: size === "md" ? "44px" : "36px",
    padding: size === "md" ? "0 var(--space-5)" : "0 var(--space-3)",
    pointerEvents: isDisabled ? "none" : "auto",
  };

  const variantStyles: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: "var(--color-accent-gold-20)",
      color: "var(--color-accent-gold)",
      borderColor: "var(--color-accent-gold-dim)",
    },
    secondary: {
      background: "transparent",
      color: "var(--color-text-secondary)",
      borderColor: "var(--color-border-default)",
    },
    cyan: {
      background: "var(--color-accent-cyan-10)",
      color: "var(--color-accent-cyan)",
      borderColor: "var(--color-accent-cyan)",
    },
  };

  return (
    <button
      {...props}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      style={{ ...baseStyle, ...variantStyles[variant], ...style }}
    >
      {loading ? (
        <SpinnerIcon />
      ) : leadingIcon ? (
        leadingIcon
      ) : null}
      {children}
      {loading && "…"}
    </button>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="spinner"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="28"
        strokeDashoffset="10"
      />
    </svg>
  );
}
