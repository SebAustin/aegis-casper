/** 24×24 SVG logomark — an amber hexagonal shield motif. */
export function AegisLogo() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Hexagonal shield outline */}
      <polygon
        points="12,2 20,6.5 20,17.5 12,22 4,17.5 4,6.5"
        stroke="var(--color-accent-gold)"
        strokeWidth="1.5"
        fill="var(--color-accent-gold-10)"
        strokeLinejoin="round"
      />
      {/* Inner "A" glyph */}
      <path
        d="M9 17l3-8 3 8M10.5 14h3"
        stroke="var(--color-accent-gold)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
