// A signed distance field in the shape of a whale, in the sense the brief
// asks for: the shape is never drawn. It exists only as a distance field that
// the text-flow current reads to know what volume to bend around — the whale
// is inferred from the current, never rendered.
//
// Built by rasterising an original whale silhouette (not DeepSeek's logo
// asset — a fresh path, referencing the same "whale in profile" idea) onto a
// small canvas, then computing distance-to-nearest-boundary-pixel for every
// cell. That's the standard two-step recipe for an SDF from a raster: get a
// boundary pixel set, then a nearest-boundary distance transform.

export interface SDFField {
  width: number;
  height: number;
  data: Float32Array; // signed distance in grid units; negative = inside
}

// The world-space rectangle the field covers. The flow field lives in this
// space; (0, 0) is the whale's centre.
export const WORLD_HALF_WIDTH = 8;
export const WORLD_HALF_HEIGHT = 4;

const GRID_W = 160;
const GRID_H = 80;

function drawWhalePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  // Unit-space control points, whale facing left, nose at roughly (-1, 0).
  // Elongated body, single dorsal-adjacent hump on the back, tail stock
  // narrowing into two flukes.
  const p = (x: number, y: number): [number, number] => [cx + x * scale, cy + y * scale];

  ctx.beginPath();
  const nose = p(-1.0, 0.02);
  ctx.moveTo(...nose);

  // nose -> top of back (over the head, up into the hump)
  ctx.bezierCurveTo(...p(-0.92, -0.28), ...p(-0.65, -0.4), ...p(-0.35, -0.36));
  // hump -> back, running toward the tail stock
  ctx.bezierCurveTo(...p(-0.05, -0.3), ...p(0.3, -0.22), ...p(0.55, -0.14));
  // tail stock -> upper fluke tip
  ctx.bezierCurveTo(...p(0.68, -0.1), ...p(0.8, -0.22), ...p(0.98, -0.34));
  // upper fluke tip -> fluke notch
  ctx.bezierCurveTo(...p(0.86, -0.16), ...p(0.8, -0.04), ...p(0.74, 0.0));
  // fluke notch -> lower fluke tip
  ctx.bezierCurveTo(...p(0.8, 0.04), ...p(0.86, 0.16), ...p(0.98, 0.34));
  // lower fluke tip -> underside of tail stock
  ctx.bezierCurveTo(...p(0.8, 0.22), ...p(0.68, 0.1), ...p(0.55, 0.14));
  // belly, running back toward the head
  ctx.bezierCurveTo(...p(0.25, 0.28), ...p(-0.1, 0.3), ...p(-0.4, 0.26));
  // underside of head -> nose, closing the path
  ctx.bezierCurveTo(...p(-0.68, 0.22), ...p(-0.9, 0.14), ...nose);

  ctx.closePath();
  ctx.fill();
}

function rasteriseWhale(): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = GRID_W;
  canvas.height = GRID_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // Sized to occupy roughly a third of the canvas, not nearly all of it —
  // the whole point of the effect is open water around a bounded absence,
  // not a shape that fills the frame.
  ctx.clearRect(0, 0, GRID_W, GRID_H);
  ctx.fillStyle = "#fff";
  drawWhalePath(ctx, GRID_W / 2, GRID_H / 2, Math.min(GRID_W, GRID_H) * 0.42);

  const { data } = ctx.getImageData(0, 0, GRID_W, GRID_H);
  const inside = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    inside[i] = data[i * 4 + 3]! > 128 ? 1 : 0;
  }
  return inside;
}

function findBoundary(inside: Uint8Array): Array<[number, number]> {
  const boundary: Array<[number, number]> = [];
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= GRID_W || y >= GRID_H ? 0 : inside[y * GRID_W + x]!;

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const here = at(x, y);
      if (here !== at(x - 1, y) || here !== at(x + 1, y) || here !== at(x, y - 1) || here !== at(x, y + 1)) {
        boundary.push([x, y]);
      }
    }
  }
  return boundary;
}

/** Builds the whale SDF once. Cheap enough (a few thousand cells against a
 * few hundred boundary points) to do synchronously at scene startup. */
export function buildWhaleSDF(): SDFField {
  const inside = rasteriseWhale();
  const boundary = findBoundary(inside);

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

/** Bilinear-sampled signed distance (in grid units) at a world-space point. */
export function sampleSDF(field: SDFField, x: number, y: number): number {
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
  return top * (1 - ty) + bottom * ty;
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
