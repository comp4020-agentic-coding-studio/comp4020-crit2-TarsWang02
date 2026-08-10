// A signed distance field in the shape of a whale, in the sense the brief
// asks for: the shape is never drawn. It exists only as a distance field that
// the text-flow current reads to know what volume to bend around — the whale
// is inferred from the current, never rendered.
//
// Rasterised in plain arithmetic (flatten the outline to a polygon, then an
// even-odd fill), not onto a 2D canvas. This module is pure geometry and the
// silhouette is the thing the whole concept rests on, so it should be
// testable without a browser — a canvas dependency here would have made
// spec/whale.test.ts impossible to run in CI, since jsdom has no real 2D
// context.

export interface SDFField {
  width: number;
  height: number;
  data: Float32Array; // signed distance in grid cells; negative = inside
}

// The world-space rectangle the field covers. The flow field lives in this
// space; (0, 0) is the whale's centre.
export const WORLD_HALF_WIDTH = 8;
export const WORLD_HALF_HEIGHT = 4;

const GRID_W = 160;
const GRID_H = 80;

// Grid cells per world unit. The rasterisation is deliberately uniform in x
// and y (160/16 == 80/8 == 10), so one scale converts distances either way.
const CELLS_PER_WORLD_UNIT = GRID_W / (2 * WORLD_HALF_WIDTH);

// Half-length of the whale along its long axis, in world units. The outline
// below is authored in unit space (x within ±1, y within ±0.4) and scaled by
// this, so the whale spans roughly 6.8 × 2.7 world units inside a 16 × 8 field.
const WHALE_SCALE = 3.4;

type Point = readonly [number, number];

// An original whale in profile, facing left — referencing the same "whale
// seen side-on" idea as DeepSeek's own mark without copying their artwork.
// Each entry is a cubic bezier: two control points, then its end point. The
// path starts at the nose and runs over the back, out to the flukes, then
// back along the belly.
const NOSE: Point = [-1.0, 0.02];
const OUTLINE: ReadonlyArray<readonly [Point, Point, Point]> = [
  // nose over the head and up into the hump
  [
    [-0.92, -0.28],
    [-0.65, -0.4],
    [-0.35, -0.36],
  ],
  // the back, running toward the tail stock
  [
    [-0.05, -0.3],
    [0.3, -0.22],
    [0.55, -0.14],
  ],
  // tail stock out to the upper fluke tip
  [
    [0.68, -0.1],
    [0.8, -0.22],
    [0.98, -0.34],
  ],
  // upper fluke back in to the notch
  [
    [0.86, -0.16],
    [0.8, -0.04],
    [0.74, 0.0],
  ],
  // notch out to the lower fluke tip
  [
    [0.8, 0.04],
    [0.86, 0.16],
    [0.98, 0.34],
  ],
  // lower fluke back in to the underside of the tail stock
  [
    [0.8, 0.22],
    [0.68, 0.1],
    [0.55, 0.14],
  ],
  // the belly, running back toward the head
  [
    [0.25, 0.28],
    [-0.1, 0.3],
    [-0.4, 0.26],
  ],
  // underside of the head, closing the path at the nose
  [
    [-0.68, 0.22],
    [-0.9, 0.14],
    NOSE,
  ],
];

const FLATTEN_STEPS = 24;

/** Flattens the bezier outline into a closed polygon in world units. */
function whalePolygon(): Point[] {
  const polygon: Point[] = [];
  let current: Point = NOSE;

  for (const [c1, c2, end] of OUTLINE) {
    for (let step = 1; step <= FLATTEN_STEPS; step++) {
      const t = step / FLATTEN_STEPS;
      const u = 1 - t;
      // Cubic Bernstein basis.
      const b0 = u * u * u;
      const b1 = 3 * u * u * t;
      const b2 = 3 * u * t * t;
      const b3 = t * t * t;
      const x = b0 * current[0] + b1 * c1[0] + b2 * c2[0] + b3 * end[0];
      const y = b0 * current[1] + b1 * c1[1] + b2 * c2[1] + b3 * end[1];
      polygon.push([x * WHALE_SCALE, y * WHALE_SCALE]);
    }
    current = end;
  }

  return polygon;
}

/** Even-odd point-in-polygon: counts how many edges a ray to the right crosses. */
function isInside(polygon: Point[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function gridToWorld(gx: number, gy: number): [number, number] {
  const x = ((gx + 0.5) / GRID_W) * (2 * WORLD_HALF_WIDTH) - WORLD_HALF_WIDTH;
  const y = ((gy + 0.5) / GRID_H) * (2 * WORLD_HALF_HEIGHT) - WORLD_HALF_HEIGHT;
  return [x, y];
}

/** Builds the whale SDF once. Cheap enough (a few thousand cells against a
 * few hundred boundary points) to do synchronously at scene startup. */
export function buildWhaleSDF(): SDFField {
  const polygon = whalePolygon();

  const inside = new Uint8Array(GRID_W * GRID_H);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const [x, y] = gridToWorld(gx, gy);
      inside[gy * GRID_W + gx] = isInside(polygon, x, y) ? 1 : 0;
    }
  }

  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= GRID_W || y >= GRID_H ? 0 : inside[y * GRID_W + x]!;

  const boundary: Array<[number, number]> = [];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const here = at(x, y);
      if (here !== at(x - 1, y) || here !== at(x + 1, y) || here !== at(x, y - 1) || here !== at(x, y + 1)) {
        boundary.push([x, y]);
      }
    }
  }

  const data = new Float32Array(GRID_W * GRID_H);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      let minD2 = Infinity;
      for (const [bx, by] of boundary) {
        const dx = x - bx;
        const dy = y - by;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) minD2 = d2;
      }
      const dist = Math.sqrt(minD2);
      const idx = y * GRID_W + x;
      data[idx] = inside[idx] === 1 ? -dist : dist;
    }
  }

  return { width: GRID_W, height: GRID_H, data };
}

function worldToGrid(field: SDFField, x: number, y: number): [number, number] {
  const gx = ((x + WORLD_HALF_WIDTH) / (2 * WORLD_HALF_WIDTH)) * field.width;
  const gy = ((y + WORLD_HALF_HEIGHT) / (2 * WORLD_HALF_HEIGHT)) * field.height;
  return [gx, gy];
}

/**
 * Bilinear-sampled signed distance in **world units** (negative inside the
 * whale). Sampling outside the rasterised rect returns a large positive
 * distance rather than the clamped edge value: callers sample this in a
 * scaled cone space (see whale-field.ts) where points routinely land far
 * outside the rect, and clamping there would wrongly report them as close to
 * the whale.
 */
export function sampleSDF(field: SDFField, x: number, y: number): number {
  const outsideX = Math.abs(x) - WORLD_HALF_WIDTH;
  const outsideY = Math.abs(y) - WORLD_HALF_HEIGHT;
  if (outsideX > 0 || outsideY > 0) {
    return Math.hypot(Math.max(outsideX, 0), Math.max(outsideY, 0)) + WORLD_HALF_HEIGHT;
  }

  const [gx, gy] = worldToGrid(field, x, y);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = gx - x0;
  const ty = gy - y0;

  const clampX = (v: number): number => Math.max(0, Math.min(field.width - 1, v));
  const clampY = (v: number): number => Math.max(0, Math.min(field.height - 1, v));

  const at = (ix: number, iy: number): number => field.data[clampY(iy) * field.width + clampX(ix)]!;

  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return (top * (1 - ty) + bottom * ty) / CELLS_PER_WORLD_UNIT;
}

const GRADIENT_EPS = 0.08;

/**
 * A repulsion vector pushing away from the whale volume, zero once `margin`
 * world units clear of the surface. Used to bend the flow field's current
 * around the inferred shape instead of letting text pass through it.
 */
export function repulsion(field: SDFField, x: number, y: number, margin: number): [number, number] {
  const d = sampleSDF(field, x, y);
  if (d > margin) return [0, 0];

  const dx = sampleSDF(field, x + GRADIENT_EPS, y) - sampleSDF(field, x - GRADIENT_EPS, y);
  const dy = sampleSDF(field, x, y + GRADIENT_EPS) - sampleSDF(field, x, y - GRADIENT_EPS);
  const len = Math.hypot(dx, dy) || 1;
  const strength = (margin - d) / margin; // 0 at the margin, 1 deep inside
  return [(dx / len) * strength, (dy / len) * strength];
}
