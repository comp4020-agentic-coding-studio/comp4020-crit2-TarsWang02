import { describe, expect, it } from "vitest";
import { strandArc } from "../src/scene";

// Every strand is meant to live one arc: arrive small, faint and soft; hold a
// readable window at full size and full sharpness; then swell past peak and
// go soft again as it passes the lens. The failure this guards has happened
// twice: scale driven off one curve and opacity off another, so the phases
// drift apart and the exit silently loses its softness entirely. That is hard
// to see in a screenshot and trivial to assert here.

describe("the strand life arc", () => {
  it("arrives small and out of focus", () => {
    const born = strandArc(0);
    expect(born.focus).toBe(0);
    expect(born.scale).toBeLessThan(0.5);
  });

  it("peaks at exactly full size and full focus", () => {
    const peak = strandArc(0.5);
    expect(peak.focus).toBeCloseTo(1, 5);
    // Exactly 1 — the readable window is the concept, so peak must not be
    // quietly scaled by a stray factor from either end of the arc.
    expect(peak.scale).toBeCloseTo(1, 5);
  });

  it("retires larger than peak and out of focus again", () => {
    const retiring = strandArc(1);
    expect(retiring.focus).toBe(0);
    // Bigger than peak, not smaller: it is passing close to the lens, not
    // receding into the distance.
    expect(retiring.scale).toBeGreaterThan(1.5);
  });

  it("is soft at both ends and sharp only in the middle", () => {
    // The specific regression: an arc that fades in but never fades out still
    // passes a birth-only check. Assert the exit is genuinely soft too.
    expect(strandArc(0.02).focus).toBeLessThan(0.5);
    expect(strandArc(0.98).focus).toBeLessThan(0.5);
    expect(strandArc(0.5).focus).toBeGreaterThan(0.9);
  });

  it("never dips below full size while in full focus", () => {
    // Wherever the text is readable it must be at its intended size — the two
    // curves meeting in the middle rather than overlapping into a pinch.
    for (let lifeT = 0; lifeT <= 1; lifeT += 0.01) {
      const { focus, scale } = strandArc(lifeT);
      if (focus > 0.99) expect(scale).toBeGreaterThanOrEqual(0.999);
    }
  });
});
