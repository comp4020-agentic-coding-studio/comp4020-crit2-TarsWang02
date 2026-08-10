// 3D gradient (Perlin) noise, plus a curl-noise helper built on top of it.
// Curl noise is the standard technique for flow that reads as a current
// rather than scattered random motion: take three offset copies of a scalar
// noise field as a vector potential (Fx, Fy, Fz), then curl gives a
// divergence-free vector field — turbulence that never has a source or a
// sink, in all three axes. Depth needs to keep moving for a strand's whole
// life (never just settle), which a 2D curl applied to x/y can't give it.
//
// Hand-rolled rather than pulled in as a dependency — permutation-table
// gradient noise is public-domain mathematics (Ken Perlin, 2002), not an
// asset to import.

const PERM_SIZE = 256;
const permutation = new Uint8Array(PERM_SIZE * 2);

function buildPermutation(seed: number): void {
  const p = new Uint8Array(PERM_SIZE);
  for (let i = 0; i < PERM_SIZE; i++) p[i] = i;

  let s = seed >>> 0 || 1;
  const rand = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 4294967296) / 4294967296;
  };

  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp!;
  }
  for (let i = 0; i < PERM_SIZE * 2; i++) {
    permutation[i] = p[i % PERM_SIZE]!;
  }
}

buildPermutation(0xdeadc0de);

// The 12 cube-edge-midpoint gradients: the classic minimal 3D gradient set.
const GRADIENTS_3D: readonly [number, number, number][] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function gradientAt3D(ix: number, iy: number, iz: number, x: number, y: number, z: number): number {
  const idx = permutation[(ix + permutation[(iy + permutation[iz & 255]!) & 255]!) & 255]! % 12;
  const [gx, gy, gz] = GRADIENTS_3D[idx]!;
  return gx * x + gy * y + gz * z;
}

/** Classic 3D Perlin noise, range roughly [-1, 1]. */
export function noise3D(x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  const sx = fade(x - x0);
  const sy = fade(y - y0);
  const sz = fade(z - z0);

  const n000 = gradientAt3D(x0 & 255, y0 & 255, z0 & 255, x - x0, y - y0, z - z0);
  const n100 = gradientAt3D(x1 & 255, y0 & 255, z0 & 255, x - x1, y - y0, z - z0);
  const n010 = gradientAt3D(x0 & 255, y1 & 255, z0 & 255, x - x0, y - y1, z - z0);
  const n110 = gradientAt3D(x1 & 255, y1 & 255, z0 & 255, x - x1, y - y1, z - z0);
  const n001 = gradientAt3D(x0 & 255, y0 & 255, z1 & 255, x - x0, y - y0, z - z1);
  const n101 = gradientAt3D(x1 & 255, y0 & 255, z1 & 255, x - x1, y - y0, z - z1);
  const n011 = gradientAt3D(x0 & 255, y1 & 255, z1 & 255, x - x0, y - y1, z - z1);
  const n111 = gradientAt3D(x1 & 255, y1 & 255, z1 & 255, x - x1, y - y1, z - z1);

  const ix00 = lerp(n000, n100, sx);
  const ix10 = lerp(n010, n110, sx);
  const ix01 = lerp(n001, n101, sx);
  const ix11 = lerp(n011, n111, sx);
  const iy0 = lerp(ix00, ix10, sy);
  const iy1 = lerp(ix01, ix11, sy);
  return lerp(iy0, iy1, sz);
}

// Large, arbitrary per-axis offsets so the three potential components read
// from decorrelated regions of the same noise field instead of one shared
// (and therefore visibly linked) signal.
const POT_OFFSET: readonly [number, number, number][] = [
  [0, 0, 0],
  [37.2, 91.1, 13.7],
  [58.9, 12.3, 77.4],
];

const CURL_EPS = 0.002;

/**
 * Curl of a 3D vector potential built from three offset noise samples.
 * Returns a genuinely three-dimensional turbulence vector — depth keeps
 * drifting along with x and y, so a strand's z never settles into stillness
 * the way a 2D curl (applied only to x/y) would let it.
 */
export function curl3D(x: number, y: number, z: number): [number, number, number] {
  const potential = (channel: number, dx: number, dy: number, dz: number): number => {
    const [ox, oy, oz] = POT_OFFSET[channel]!;
    return noise3D(x + ox + dx, y + oy + dy, z + oz + dz);
  };

  const dFzDy = (potential(2, 0, CURL_EPS, 0) - potential(2, 0, -CURL_EPS, 0)) / (2 * CURL_EPS);
  const dFyDz = (potential(1, 0, 0, CURL_EPS) - potential(1, 0, 0, -CURL_EPS)) / (2 * CURL_EPS);
  const dFxDz = (potential(0, 0, 0, CURL_EPS) - potential(0, 0, 0, -CURL_EPS)) / (2 * CURL_EPS);
  const dFzDx = (potential(2, CURL_EPS, 0, 0) - potential(2, -CURL_EPS, 0, 0)) / (2 * CURL_EPS);
  const dFyDx = (potential(1, CURL_EPS, 0, 0) - potential(1, -CURL_EPS, 0, 0)) / (2 * CURL_EPS);
  const dFxDy = (potential(0, 0, CURL_EPS, 0) - potential(0, 0, -CURL_EPS, 0)) / (2 * CURL_EPS);

  return [dFzDy - dFyDz, dFxDz - dFzDx, dFyDx - dFxDy];
}
