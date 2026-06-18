import { CockpitGrid } from "@/components/cockpit/CockpitGrid";

export default function CockpitPage() {
  return (
    <main
      id="main-cockpit"
      aria-label="Aegis cockpit"
      style={{
        paddingTop: "calc(var(--header-height) + var(--space-6))",
        paddingBottom: "var(--space-8)",
      }}
    >
      <CockpitGrid />
    </main>
  );
}
