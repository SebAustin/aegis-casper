type ChipVariant = "live" | "paused" | "stale" | "aging" | "fresh";

interface StatusChipProps {
  variant: ChipVariant;
  label?: string;
}

const LABELS: Record<ChipVariant, string> = {
  live:   "LIVE",
  paused: "PAUSED",
  stale:  "STALE",
  aging:  "AGING",
  fresh:  "FRESH",
};

/**
 * Status chip for vault and oracle panels.
 * Color + text label — never color alone (DESIGN.md §8, color independence).
 */
export function StatusChip({ variant, label }: StatusChipProps) {
  const text = label ?? LABELS[variant];
  return (
    <span
      role="status"
      aria-label={`Status: ${text}`}
      className={`chip chip--${variant}`}
    >
      {text}
    </span>
  );
}
