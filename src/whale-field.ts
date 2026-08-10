import { repulsion, sampleSDF, type SDFField } from "./sdf";

// One coordinate frame for the whale and the strand field.
//
// The strand band is camera-relative: it travels down with the dive so the
// camera is always descending into fresh text. The whale is defined in the
// same frame — a distance *in front of the camera* that closes as the dive
// proceeds — rather than pinned to a world z.
//
// Why camera-relative rather than a fixed world anchor: with a world anchor,
// the whale's position within the live band is an accident of wherever the
// camera happens to be. At the surface it sat mid-band; fully descended it
// drifted to the band's top edge, among strands that are fading out to
// retire, so the shape dissolved exactly when the concept wants it largest.
// Anchoring it to the camera makes "the whale is N units ahead, closing"
// an invariant that holds at every value of dive progress, and the closing
// distance is what makes it loom: same world size, nearer camera, bigger on
// screen — which is the beat the brief describes, ending at the eye.
const WHALE_DISTANCE_SURFACE = 12;
const WHALE_DISTANCE_EYE = 3.4;

/** How far in front of the camera the whale sits at dive progress `p`. */
export function whaleDistanceAt(p: number): number {
  return WHALE_DISTANCE_SURFACE + (WHALE_DISTANCE_EYE - WHALE_DISTANCE_SURFACE) * p;
}

// Below this distance in front of the lens a strand is treated as having no
// whale to avoid: the cone has narrowed to nothing there, and dividing by a
// vanishing depth would blow the scale up.
const MIN_DEPTH_AHEAD = 0.35;

// Ceiling on how far a single frame's whale push can carry a strand.
const MAX_WORLD_PUSH_SCALE = 4;

/**
 * Maps a strand's world offset to the whale's own space.
 *
 * The exclusion is a **cone from the camera**, not a tube. A strand at
 * distance `depthAhead` sits inside the whale's projected footprint when its
 * angular position falls within the whale's angular extent — that is, when
 * `offset / depthAhead` is within `whaleHalfExtent / whaleDistance`. Scaling
 * the sample point by `whaleDistance / depthAhead` turns that test back into
 * a plain lookup against the fixed-size SDF.
 *
 * This is what makes the silhouette legible. A tube (the same world-space
 * hole at every depth) projects to a *different* screen region per depth —
 * near strands carve a wide hole, far strands a narrow one — so the edge
 * smears. A cone projects to exactly one screen region at every depth, so
 * every layer of the field reinforces the same outline.
 */
export function toWhaleSpace(x: number, y: number, depthAhead: number, whaleDistance: number): [number, number] {
  const scale = whaleDistance / Math.max(depthAhead, MIN_DEPTH_AHEAD);
  return [x * scale, y * scale];
}

/**
 * Signed distance from the whale's projected footprint, in whale space.
 * Negative inside. Depth-independent by construction: two strands at
 * different depths that project to the same screen point return the same
 * value.
 */
export function whaleSignedDistance(
  sdf: SDFField,
  x: number,
  y: number,
  depthAhead: number,
  whaleDistance: number,
): number {
  const [wx, wy] = toWhaleSpace(x, y, depthAhead, whaleDistance);
  return sampleSDF(sdf, wx, wy);
}

/**
 * World-space push that clears a strand out of the whale's projected
 * footprint. Applies at every depth ahead of the camera — not gated to a
 * narrow slab around one z — because an absence that only some layers of the
 * field respect is an absence the other layers fill straight back in.
 *
 * The direction is computed in whale space and carried back unchanged (the
 * mapping is a uniform scale, so it preserves direction); the magnitude is
 * converted back to world units, which is why far strands are pushed harder:
 * they must travel further in world space to clear the same angular region.
 */
export function whaleRepulsion(
  sdf: SDFField,
  x: number,
  y: number,
  depthAhead: number,
  whaleDistance: number,
  margin: number,
): [number, number] {
  const clampedDepth = Math.max(depthAhead, MIN_DEPTH_AHEAD);
  const scale = whaleDistance / clampedDepth;
  const [rx, ry] = repulsion(sdf, x * scale, y * scale, margin);
  if (rx === 0 && ry === 0) return [0, 0];
  // Whale space back to world units is a divide by `scale`, i.e. multiply by
  // depthAhead / whaleDistance — so the push grows with depth, which is what
  // clearing the same angular region further away actually costs. Capped so a
  // very distant strand deep inside the cone can't be flung across the field
  // in one frame.
  const worldScale = Math.min(clampedDepth / whaleDistance, MAX_WORLD_PUSH_SCALE);
  return [rx * worldScale, ry * worldScale];
}
