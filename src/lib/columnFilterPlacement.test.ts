import { describe, expect, it } from "vitest";
import { placeColumnFilterDropdown } from "./columnFilterPlacement";

// A funnel is a 16Ã—16 button; the dropdown is 240 px wide.
const funnel = (left: number, top: number) => ({ left, right: left + 16, top, bottom: top + 16 });

describe("placeColumnFilterDropdown", () => {
  it("opens under the funnel, lined up with its left side, when there's room", () => {
    expect(placeColumnFilterDropdown(funnel(300, 200), 1920, 1080, 330)).toEqual({ top: 220, left: 300 });
  });

  it("the Ticket List's last column (Posting) at the right edge stays on screen", () => {
    // funnel at x 1810 in an 854-px-wide screenshot was cut off; same at 1920 wide
    const p = placeColumnFilterDropdown(funnel(1810, 200), 1920, 1080, 330);
    expect(p.left).toBe(1810 + 16 - 240); // lined up with the funnel's right side
    expect(p.left + 240).toBeLessThanOrEqual(1920 - 8);
    const narrow = placeColumnFilterDropdown(funnel(840, 200), 854, 900, 330);
    expect(narrow.left + 240).toBeLessThanOrEqual(854 - 8);
    expect(narrow.left).toBeGreaterThanOrEqual(8);
  });

  it("never past the left edge on a very narrow screen", () => {
    expect(placeColumnFilterDropdown(funnel(4, 200), 250, 800, 330).left).toBe(8);
  });

  it("opens upward near the bottom, only when it fits above", () => {
    expect(placeColumnFilterDropdown(funnel(300, 900), 1920, 1000, 330).top).toBe(900 - 4 - 330);
    // no room above either â†’ stays below
    expect(placeColumnFilterDropdown(funnel(300, 100), 1920, 300, 330).top).toBe(120);
    // height unknown yet (first placement) â†’ below
    expect(placeColumnFilterDropdown(funnel(300, 900), 1920, 1000, 0).top).toBe(920);
  });
});
