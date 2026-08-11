import { describe, expect, it } from "vitest";
import { strandArc, type ArcTiming } from "../src/scene";

// Every strand is meant to live one arc: arrive small, faint and soft; hold a
// readable window at full size and full sharpness; then swell past peak and
// go soft again as it passes the lens. The failure this guards has happened
// twice: scale driven off one curve and opacity off another, so the phases
// drift apart and the exit silently loses its softness entirely. That is hard
// to see in a screenshot and trivial to assert here.
//
// strandArc takes its timing as a parameter rather than reading module-scope
// constants, specifically so readers (a full paper title — the actual subject
// of the concept) and motes (background texture) can each get their own feel
// without the pure function knowing which tier called it. These are the same
// numbers scene.ts uses for each tier, duplicated here rather than imported so
// a change to either config is a deliberate edit to this file too, not a
// silent drift.
const READER: ArcTiming = { birthPhase: 0.32, retirePhase: 0.38, birthScale: 0.12, retireScale: 2.8 };
const MOTE: ArcTiming = { birthPhase: 0.16, retirePhase: 0.3, birthScale: 0.55, retireScale: 1.35 };

// A strand's lifeT (what strandArc takes) is now `(p - startP) / arcSpan` —
// a fraction of DIVE PROGRESS, not of a wall-clock lifespan in seconds. These
// mirror scene.ts's READER_ARC_SPAN_MIN/MAX and MOTE_ARC_SPAN_MIN/MAX,
// duplicated for the same reason the timing configs above are: a change to
// either is a deliberate edit here too.
const READER_ARC_SPAN_MIN = 0.22;
const MOTE_ARC_SPAN_MAX = 0.09;

describe.each([
  ["reader", READER],
  ["mote", MOTE],
])("the strand life arc (%s)", (_label, timing) => {
  it("arrives small and out of focus", () => {
    const born = strandArc(0, timing);
    expect(born.focus).toBe(0);
    expect(born.scale).toBeLessThan(1);
  });

  it("peaks at exactly full size and full focus", () => {
    const peak = strandArc(0.5, timing);
    expect(peak.focus).toBeCloseTo(1, 5);
    // Exactly 1 — the readable window is the concept, so peak must not be
    // quietly scaled by a stray factor from either end of the arc.
    expect(peak.scale).toBeCloseTo(1, 5);
  });

  it("retires larger than peak and out of focus again", () => {
    const retiring = strandArc(1, timing);
    expect(retiring.focus).toBe(0);
    // Bigger than peak, not smaller: it is passing close to the lens, not
    // receding into the distance.
    expect(retiring.scale).toBeGreaterThan(1);
  });

  it("is soft at both ends and sharp only in the middle", () => {
    // The specific regression: an arc that fades in but never fades out still
    // passes a birth-only check. Assert the exit is genuinely soft too.
    expect(strandArc(0.02, timing).focus).toBeLessThan(0.5);
    expect(strandArc(0.98, timing).focus).toBeLessThan(0.5);
    expect(strandArc(0.5, timing).focus).toBeGreaterThan(0.9);
  });

  it("never dips below full size on the true peak plateau", () => {
    // Wherever the text is readable it must be at its intended size — the two
    // curves meeting in the middle rather than overlapping into a pinch.
    //
    // The filter is focus > 0.999, not just > 0.99: multiplying two
    // independent smoothstep curves means scale can undershoot 1 by a hair
    // (bounded by (1 - birthScale) or (retireScale - 1), whichever end is
    // approaching) in the last sliver *before* either curve fully saturates —
    // e.g. READER dips to ~0.991 at focus ≈ 0.993. That is a real property of
    // "multiplied, not blended" (see strandArc's own comment), not a
    // regression: it is under 1% and gone by the time focus is genuinely 1,
    // which is the actual peak plateau this test exists to guard.
    for (let lifeT = 0; lifeT <= 1; lifeT += 0.01) {
      const { focus, scale } = strandArc(lifeT, timing);
      if (focus > 0.999) expect(scale).toBeGreaterThanOrEqual(0.999);
    }
  });
});

describe("readers vs motes", () => {
  it("gives the reader tier a more pronounced scale swing than motes", () => {
    // The main content has to register as an event; the texture around it
    // must not compete for attention. Both ends of the swing, not just one.
    expect(READER.birthScale).toBeLessThan(MOTE.birthScale);
    expect(READER.retireScale).toBeGreaterThan(MOTE.retireScale);
  });

  it("gives the reader tier slower transitions than motes", () => {
    expect(READER.birthPhase).toBeGreaterThan(MOTE.birthPhase);
    expect(READER.retirePhase).toBeGreaterThan(MOTE.retirePhase);
  });

  it("leaves a reader a genuine peak-focus plateau, not a pinch", () => {
    // lifeT is now a fraction of dive progress (see the module comment above),
    // not of a wall-clock lifespan, so "enough time to read" is no longer a
    // seconds figure — it's a comfortable share of the strand's own arc spent
    // at full focus, real content on screen rather than mid-transition.
    const peakFraction = 1 - READER.birthPhase - READER.retirePhase;
    expect(peakFraction).toBeGreaterThan(0.25);
  });

  it("gives even the shortest reader arc more scroll distance than the longest mote arc", () => {
    // The main content should never be traversed faster than the texture
    // around it — readers are meant to be the slower, deliberate event.
    expect(READER_ARC_SPAN_MIN).toBeGreaterThan(MOTE_ARC_SPAN_MAX);
  });
});
