import { describe, expect, it } from "vitest";
import { buildWhaleSDF, sampleSDF } from "../src/sdf";
import { whaleDistanceAt, whaleDistanceScaleFor, whaleRepulsion, whaleSignedDistance } from "../src/whale-field";

// The concept promises a whale you never see drawn, inferred only from the
// text current bending around it. That only reads if the absence projects to
// one coherent shape from the camera — the same screen region at every depth
// of the field, at every point of the dive. These assert that property
// directly, so a change that quietly re-introduces a depth-gated or
// world-pinned exclusion fails here rather than at a crit.
//
// The pixel-level counterpart (does the rendered canvas actually show a hole)
// needs a real browser and lives in scripts/probe-whale.js; this is the part
// that can hold the line in CI.

// jsdom gives buildWhaleSDF the 2D canvas it rasterises into.
const sdf = buildWhaleSDF();

describe("whale SDF", () => {
  it("puts the whale's body inside and open water outside", () => {
    expect(sampleSDF(sdf, 0, 0)).toBeLessThan(0);
    expect(sampleSDF(sdf, 7.5, 3.5)).toBeGreaterThan(0);
  });

  it("reports a large distance well outside the rasterised rect", () => {
    // Cone-space sampling routinely lands far outside the rect. Clamping to
    // the edge value there would wrongly report those points as near the
    // whale, and every strand in the field would flinch from nothing.
    expect(sampleSDF(sdf, 400, 0)).toBeGreaterThan(10);
    expect(sampleSDF(sdf, 0, 400)).toBeGreaterThan(10);
  });
});

describe("whale exclusion is a cone from the camera", () => {
  const whaleDistance = whaleDistanceAt(0.5);

  it("projects to the same footprint regardless of a strand's depth", () => {
    // One screen direction, sampled at four different depths. A strand twice
    // as far sits at twice the world offset for the same screen position, so
    // all four must agree — that is what a cone means.
    for (const [nx, ny] of [
      [0, 0],
      [0.15, 0.02],
      [0.3, 0.06],
      [0.45, 0.09],
    ]) {
      const atDepth = (depth: number): number =>
        whaleSignedDistance(sdf, nx * depth, ny * depth, depth, whaleDistance);

      const reference = atDepth(4);
      for (const depth of [8, 15, 26]) {
        expect(atDepth(depth)).toBeCloseTo(reference, 5);
      }
    }
  });

  it("holds a strand inside the footprint at every depth, near and far", () => {
    // Fault this replaced: repulsion multiplied by a Gaussian in z, so only
    // strands near one depth avoided the whale and every other layer flew
    // straight through the hole.
    for (const depth of [2, 6, 12, 20, 30]) {
      const [rx, ry] = whaleRepulsion(sdf, 0, 0, depth, whaleDistance, 1.2);
      expect(Math.hypot(rx, ry), `no push at depth ${depth}`).toBeGreaterThan(0);
    }
  });

  it("leaves strands well outside the footprint alone", () => {
    const depth = 12;
    // Far off-axis for this depth: outside the cone, so nothing should move.
    const [rx, ry] = whaleRepulsion(sdf, 7 * depth, 3 * depth, depth, whaleDistance, 1.2);
    expect(Math.hypot(rx, ry)).toBe(0);
  });

  it("keeps the whale's apparent width the same on a phone as on a desktop", () => {
    // Both viewports are full marking environments. Uncorrected, the 390×844
    // whale spanned 118% of the half-screen width at the surface and 416% at
    // the eye — off both edges from the first frame, so no silhouette could
    // ever read there. Apparent width is halfWidth / (distance·tan(fov/2)·
    // aspect), so scaling distance by the aspect ratio cancels it exactly.
    const fovHalfTan = Math.tan((55 / 2) * (Math.PI / 180));
    const apparentWidth = (aspect: number, p: number): number => {
      const distance = whaleDistanceAt(p) * whaleDistanceScaleFor(aspect);
      return 1 / (distance * fovHalfTan * aspect);
    };

    for (const p of [0, 0.5, 1]) {
      expect(apparentWidth(390 / 844, p)).toBeCloseTo(apparentWidth(1920 / 1080, p), 6);
    }
  });

  it("never pulls the whale nearer than the landscape calibration", () => {
    // The correction only ever pushes the whale further away. A wider-than-
    // reference monitor must not drag it closer and blow it past the frame.
    expect(whaleDistanceScaleFor(1920 / 1080)).toBe(1);
    expect(whaleDistanceScaleFor(21 / 9)).toBe(1);
    expect(whaleDistanceScaleFor(390 / 844)).toBeGreaterThan(1);
  });

  it("grows the whale's angular size as the dive closes on it", () => {
    // Same world offset, same depth; only dive progress differs. As the
    // whale closes, that offset should fall further inside its footprint.
    const offset = 1.2;
    const depth = 10;
    const early = whaleSignedDistance(sdf, offset, 0, depth, whaleDistanceAt(0));
    const late = whaleSignedDistance(sdf, offset, 0, depth, whaleDistanceAt(1));
    expect(late).toBeLessThan(early);
    expect(whaleDistanceAt(1)).toBeLessThan(whaleDistanceAt(0));
  });
});
