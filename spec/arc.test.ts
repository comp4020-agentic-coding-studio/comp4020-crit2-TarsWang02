import { describe, expect, it } from "vitest";
import { strandArc, narrationStateAt, logoResolveAmount, glowBrightness, type ArcTiming } from "../src/scene";

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

// The hero slot cycles through several of DeepSeek's own lines rather than
// showing one tagline for the whole dive — narrationStateAt is what decides
// which line (if any) owns a given point in the dive, and reuses strandArc
// for its opacity/scale rather than a separate opacity-only fade.
describe("narrationStateAt", () => {
  it("shows nothing before the first line's window opens", () => {
    // No line's own window starts before the surface, but the gap check
    // itself is the point: strandArc's boundary maths (focus=0 but
    // defocus=1) must not leak a ghost line into view the way an ungated
    // strand once did (see the tick loop's own comment on that failure).
    expect(narrationStateAt(-0.01).activeIndex).toBe(-1);
  });

  it("leaves gaps of no active line between statements", () => {
    // The brief asked for lines to read as distinct events through the dive,
    // not one continuous statement — so somewhere between the first line's
    // window and the second, dive progress must pass through a stretch with
    // no active line at all.
    let sawGap = false;
    for (let p = 0.12; p <= 0.17; p += 0.01) {
      if (narrationStateAt(p).activeIndex === -1) sawGap = true;
    }
    expect(sawGap).toBe(true);
  });

  it("arrives small and blurred, peaks sharp, leaves larger and blurred again", () => {
    const early = narrationStateAt(0.001); // just inside the first line's window
    const mid = narrationStateAt(0.06); // its window's own midpoint
    expect(early.scale).toBeLessThan(1);
    expect(early.blurPx).toBeGreaterThan(0);
    expect(mid.scale).toBeCloseTo(1, 1);
    expect(mid.blurPx).toBeLessThan(1);
  });

  it("grows larger, not smaller, as a line leaves — the same 'closing in' read a strand gets", () => {
    const retiring = narrationStateAt(0.117); // just before the first window closes
    expect(retiring.scale).toBeGreaterThan(1);
  });

  it("finishes every line before #eye starts closing over the canvas", () => {
    // #depth is 400vh and #eye is 220vh, both scaling with viewport height
    // the same way, so #eye's clip-path trigger always starts at dive
    // progress 400/620 regardless of viewport size — text scheduled past
    // that point would fade out (or simply sit) behind an iris the reader
    // can no longer see through. This is exactly the bug the first version
    // of this schedule had: two lines ran past that boundary unnoticed
    // because nothing asserted it.
    const eyeCloseStart = 400 / 620;
    for (let p = eyeCloseStart - 0.015; p < eyeCloseStart; p += 0.005) {
      expect(narrationStateAt(p).activeIndex, `line still active at p=${p}`).toBe(-1);
    }
  });
});

// The mark stays an undefined cluster of light for most of the dive and only
// resolves into DeepSeek's actual logo in the approach to the eye — the
// opposite of rendering it fully legible from frame one.
describe("logoResolveAmount", () => {
  it("is fully unresolved through most of the reading section", () => {
    expect(logoResolveAmount(0)).toBe(0);
    expect(logoResolveAmount(0.3)).toBe(0);
  });

  it("resolves fully before #eye starts closing over it", () => {
    // #eye's own clip-path trigger begins around p ≈ 0.645 given the current
    // #depth/#eye height ratio (see the constant's own comment) — resolution
    // must finish before that, or the reveal happens behind an already-black
    // screen. 0.64 is deliberately not later than that.
    expect(logoResolveAmount(0.64)).toBe(1);
    expect(logoResolveAmount(1)).toBe(1);
  });

  it("only sharpens in its own late window, not gradually across the whole dive", () => {
    expect(logoResolveAmount(0.45)).toBe(0);
    expect(logoResolveAmount(0.57)).toBeGreaterThan(0);
    expect(logoResolveAmount(0.57)).toBeLessThan(1);
  });
});

// The ambient glow stays dim through the first half of the dive rather than
// being bright from frame one — it should read as "something is there", not
// compete with the reading, until the dive is genuinely closing on the mark.
describe("glowBrightness", () => {
  it("stays flat and dim before the halfway point", () => {
    const atStart = glowBrightness(0);
    const atQuarter = glowBrightness(0.25);
    const atHalf = glowBrightness(0.5);
    expect(atStart).toBeCloseTo(atQuarter, 5);
    expect(atQuarter).toBeCloseTo(atHalf, 5);
  });

  it("brightens only after the halfway point, toward the eye", () => {
    const atHalf = glowBrightness(0.5);
    const atEnd = glowBrightness(1);
    expect(atEnd).toBeGreaterThan(atHalf);
  });
});
