/**
 * Unit tests for the StatusChip component.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusChip } from "../components/ui/StatusChip";

describe("StatusChip", () => {
  it("renders with 'live' variant and correct text", () => {
    render(<StatusChip variant="live" />);
    const chip = screen.getByRole("status");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("LIVE");
    expect(chip).toHaveAttribute("aria-label", "Status: LIVE");
  });

  it("renders with 'paused' variant", () => {
    render(<StatusChip variant="paused" />);
    expect(screen.getByRole("status")).toHaveTextContent("PAUSED");
  });

  it("renders with 'stale' variant", () => {
    render(<StatusChip variant="stale" />);
    expect(screen.getByRole("status")).toHaveTextContent("STALE");
  });

  it("accepts a custom label", () => {
    render(<StatusChip variant="live" label="ONLINE" />);
    expect(screen.getByRole("status")).toHaveTextContent("ONLINE");
  });

  it("applies the correct CSS class", () => {
    render(<StatusChip variant="fresh" />);
    const chip = screen.getByRole("status");
    expect(chip.className).toContain("chip--fresh");
  });
});
