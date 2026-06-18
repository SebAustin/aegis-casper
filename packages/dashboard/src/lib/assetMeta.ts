/**
 * Static asset slot metadata.
 *
 * Segment colors are pre-assigned by position (0–4) per DESIGN.md §6.5.
 * Never dynamically random — colour assignment must be stable across
 * reallocations.
 */

export interface AssetMeta {
  label: string;
  color: string;
  letter: string;
}

/** Stable color and label assignment by asset slot index (0–4). */
export const ASSET_META: AssetMeta[] = [
  { label: "Asset 1", color: "oklch(78% 0.165 72)",   letter: "A" }, // --color-accent-gold
  { label: "Asset 2", color: "oklch(68% 0.14 185)",   letter: "B" }, // mid cyan
  { label: "Asset 3", color: "oklch(65% 0.12 280)",   letter: "C" }, // steel blue
  { label: "Asset 4", color: "oklch(60% 0.10 150)",   letter: "D" }, // sage
  { label: "Asset 5", color: "oklch(55% 0.08 320)",   letter: "E" }, // muted violet
];

/** Returns the display label from oracle data, falling back to the slot label. */
export function getAssetLabelFromMeta(assetId: number, oracleName?: string): string {
  return oracleName ?? ASSET_META[assetId]?.label ?? `Asset ${assetId + 1}`;
}
