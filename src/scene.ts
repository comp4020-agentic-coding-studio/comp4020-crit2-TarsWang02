import * as THREE from "three";
import { Text } from "troika-three-text";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { curl3D } from "./noise";
import { buildWhaleSDF, repulsion, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH, type SDFField } from "./sdf";
import { papers } from "./papers";

gsap.registerPlugin(ScrollTrigger);

// The whale is never drawn — only this z-band and (x, y) SDF define the
// volume the current bends around. See src/sdf.ts.
const WHALE_Z = -1.5;
const WHALE_Z_SPREAD = 3;
const REPULSION_MARGIN = 1.2;
const REPULSION_MARGIN_DESCENDED = 2.6;

// Scrolling is descending: the camera sinks toward the whale's z-band, the
// water darkens and thickens, and its margin (so its inferred volume reads
// as nearer and larger) grows — all driven by scroll progress through the
// #depth section plus the eye, not by time.
const CAMERA_Z_SURFACE = 9;
const CAMERA_Z_DESCENDED = 1.4;
const FOG_DENSITY_SURFACE = 0.07;
// FogExp2's falloff is exp(-(density * distance)^2) — steep. At the FAR_DIST
// (15) a strand can be from the camera, 0.2 leaves it at ~exp(-9) ≈ 0.0001,
// i.e. invisible regardless of anything else; 0.1 leaves ~exp(-2.25) ≈ 0.1,
// dim but real. Tuned against NEAR_DIST/FAR_DIST below, not picked first.
const FOG_DENSITY_DESCENDED = 0.1;
const COLOR_DESCENDED = 0x000103;

// Gentle, continuous, never-repeating camera drift (real underwater camera
// movement is never perfectly steady) — this and the strands' own constant
// rise are what keep the dive reading as passing through a volume rather
// than dollying toward a static picture.
const CAMERA_JITTER_AMOUNT = 0.22;
const CAMERA_JITTER_SPEED = 0.12;

// Every strand is a bubble with a life: born small, faint and deep, rising
// continuously toward the surface, fading out and retiring as it arrives —
// at which point a new one is born to replace it.
//
// Life bounds are defined relative to the camera's current z, not as fixed
// world coordinates. A strand born at a fixed world depth would work fine
// while the camera sits still, but the camera dives from z=9 to z=1.4 over
// the scroll — a strand living out its life at, say, world z=6 starts in
// front of a surface-height camera and ends up behind a descended one,
// outside the view frustum, invisible. Recomputing the band from the live
// camera position every frame means the medium is always arriving: exactly
// the feel of a diver moving through water rather than water sitting still
// while the diver approaches it.
const RETIRE_LEAD = 2; // a retiring strand is this far in front of the camera — near, not at, the lens
const LIFE_RANGE = 13; // total travel distance from birth to retirement
const LIFESPAN_MIN = 16;
const LIFESPAN_MAX = 26;

const DEEP_NAVY = 0x040814;
const CURRENT_BLUE = 0x4d6bfe;

interface Strand {
  mesh: Text;
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeY: number;
  // Generation zero's target distance from the (camera-relative) retirement
  // plane, eased toward over the opening spread — see DEPTH_SPREAD_FRACTION.
  // Unused once a strand has respawned into the ordinary lifecycle.
  homeOffset: number;
  phase: number;
  speed: number;
  baseOpacity: number;
  birthTime: number;
  lifespan: number;
  // True only for the initial population, and only until it first retires.
  // Generation zero plays the flat-surface opening beat (see
  // DEPTH_SPREAD_FRACTION below); every strand born after that follows the
  // ordinary deep-birth-to-surface lifecycle.
  isGenZero: boolean;
}

// The one-time flat-to-volumetric spread on load: generation zero starts
// flat at the (camera-relative) retirement plane and eases out to its own
// settled offset as the reader scrolls, so the very first view reads as text
// floating on the surface before the dive opens it into a real volume. It is
// not, however, the last time depth moves — see Z_WOBBLE_AMOUNT below, and
// every strand (generation zero included) still lives out a lifespan and
// retires into the ordinary rising lifecycle.
const FADE_IN_DURATION = 1.6;
const FADE_OUT_DURATION = 2.4;
const BIRTH_SCALE_START = 0.15;
const DEPTH_SPREAD_FRACTION = 0.6; // dive progress at which the opening spread completes
const NOISE_FREQ = 0.18;
const FLOW_SPEED = 0.9;
const SPRING_K = 0.35;
const Z_WOBBLE_AMOUNT = 1.1; // continuous 3D-curl depth turbulence, on top of the rise/spread

// Camera-relative distance, not absolute z — the camera itself moves
// continuously now, so opacity has to fade by how far a strand actually is
// from the camera at this instant, not by its position in a fixed world band.
const NEAR_DIST = 3;
const FAR_DIST = 15;

function fragment(): string {
  const fragments = [
    "671B total · 37B activated",
    "256 experts · 8 active",
    "5.5% activation ratio",
    "128,000 token context",
    "14.8 trillion training tokens",
    "93.3% smaller KV cache",
  ];
  return fragments[Math.floor(Math.random() * fragments.length)]!;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Cell-jittered positions across the world's (x, y) extent — spreads the
 * initial population out evenly rather than by chance. Later respawns don't
 * need this: a continuously cycling population reads fine from plain random
 * placement.
 */
function jitteredPositions(count: number): Array<[number, number]> {
  const aspect = WORLD_HALF_WIDTH / WORLD_HALF_HEIGHT;
  const cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = (2 * WORLD_HALF_WIDTH) / cols;
  const cellH = (2 * WORLD_HALF_HEIGHT) / rows;

  const cells: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push([-WORLD_HALF_WIDTH + (c + 0.5) * cellW, -WORLD_HALF_HEIGHT + (r + 0.5) * cellH]);
    }
  }

  return shuffle(cells)
    .slice(0, count)
    .map(([cx, cy]) => [cx + rand(-cellW * 0.35, cellW * 0.35), cy + rand(-cellH * 0.35, cellH * 0.35)]);
}

/** Nudges a spawn point clear of the whale's margin so no strand starts life
 * inside the volume it's meant to avoid. */
function clearOfWhale(sdf: SDFField, x: number, y: number): [number, number] {
  let px = x;
  let py = y;
  for (let i = 0; i < 8; i++) {
    const [rx, ry] = repulsion(sdf, px, py, REPULSION_MARGIN);
    if (rx === 0 && ry === 0) break;
    px += rx * 0.6;
    py += ry * 0.6;
  }
  return [px, py];
}

function randomSpawnXY(sdf: SDFField): [number, number] {
  const rawX = rand(-WORLD_HALF_WIDTH * 0.92, WORLD_HALF_WIDTH * 0.92);
  const rawY = rand(-WORLD_HALF_HEIGHT * 0.92, WORLD_HALF_HEIGHT * 0.92);
  return clearOfWhale(sdf, rawX, rawY);
}

/** Picks the next strand's text and font size from the real content pool —
 * titles, notes and fact-fragments — roughly matching the original mix. */
function pickEntry(isCompact: boolean): { str: string; fontSize: number } {
  const roll = Math.random();
  if (roll < 0.4) {
    const paper = papers[Math.floor(Math.random() * papers.length)]!;
    return { str: paper.title, fontSize: rand(0.26, 0.32) };
  }
  if (!isCompact && roll < 0.7) {
    const paper = papers[Math.floor(Math.random() * papers.length)]!;
    return { str: paper.note, fontSize: rand(0.16, 0.19) };
  }
  return { str: fragment(), fontSize: rand(0.3, 0.5) };
}

const POPULATION_FULL = 24;
const POPULATION_COMPACT = 12;
const INITIAL_STAGGER = 4.5; // generation zero trickles in over this many seconds

function buildStrands(sdf: SDFField, isCompact: boolean): Strand[] {
  const count = isCompact ? POPULATION_COMPACT : POPULATION_FULL;
  const positions = jitteredPositions(count);

  return positions.map(([rawX, rawY]) => {
    const { str, fontSize } = pickEntry(isCompact);
    const mesh = new Text();
    mesh.text = str;
    mesh.fontSize = fontSize;
    mesh.color = CURRENT_BLUE;
    mesh.anchorX = "center";
    mesh.anchorY = "middle";
    mesh.letterSpacing = 0.01;
    mesh.outlineWidth = 0;
    mesh.fillOpacity = 0;
    mesh.sync();

    const [x, y] = clearOfWhale(sdf, rawX, rawY);
    const homeOffset = rand(0, LIFE_RANGE);
    // Generation zero starts flat at the retirement plane (offset 0 from the
    // camera), not at its eventual depth — the world z here is only a
    // starting guess for this first frame; tick() recomputes it relative to
    // the live camera before anything renders.
    mesh.position.set(x, y, CAMERA_Z_SURFACE - RETIRE_LEAD);

    return {
      mesh,
      x,
      y,
      z: CAMERA_Z_SURFACE - RETIRE_LEAD,
      homeX: x,
      homeY: y,
      homeOffset,
      phase: rand(0, 1000),
      speed: rand(0.35, 0.75),
      baseOpacity: rand(0.45, 0.9),
      birthTime: rand(0, INITIAL_STAGGER),
      lifespan: rand(LIFESPAN_MIN, LIFESPAN_MAX),
      isGenZero: true,
    };
  });
}

/** Retires a strand and immediately rebirths it as an ordinary deep-water
 * bubble: new text, new position, new life. The pool never grows or shrinks
 * — one retires, one is born, in the same slot. */
function respawn(strand: Strand, sdf: SDFField, now: number, isCompact: boolean): void {
  const { str, fontSize } = pickEntry(isCompact);
  strand.mesh.text = str;
  strand.mesh.fontSize = fontSize;
  strand.mesh.sync();

  const [x, y] = randomSpawnXY(sdf);
  strand.x = x;
  strand.y = y;
  strand.homeX = x;
  strand.homeY = y;
  // strand.z is recomputed relative to the live camera on the very next
  // tick — no need to guess a world-space starting value here.
  strand.phase = rand(0, 1000);
  strand.speed = rand(0.35, 0.75);
  strand.baseOpacity = rand(0.45, 0.9);
  strand.birthTime = now;
  strand.lifespan = rand(LIFESPAN_MIN, LIFESPAN_MAX);
  strand.isGenZero = false;
}

export interface SceneHandle {
  dispose: () => void;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const isCompact = window.innerWidth < 700;
  const dpr = Math.min(window.devicePixelRatio || 1, isCompact ? 1.5 : 2);

  // preserveDrawingBuffer: without it, reading the canvas back (devtools,
  // gl.readPixels, screenshot tooling) can race the browser clearing the
  // buffer between frames and report nothing rendered when the scene is
  // actually fine — exactly the kind of false signal that makes a real bug
  // report hard to trust. Worth the small cost for that alone.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(DEEP_NAVY, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(DEEP_NAVY, 0.07);

  const camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  const cameraBase = new THREE.Vector3(0, 0, CAMERA_Z_SURFACE);
  camera.position.copy(cameraBase);
  camera.lookAt(0, 0, 0);

  const sdf = buildWhaleSDF();
  const strands = buildStrands(sdf, isCompact);
  for (const strand of strands) scene.add(strand.mesh);

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // One continuous dive spanning the whole research read plus the eye — not
  // just the eye section — so the descent (camera, fog, colour, and the
  // generation-zero opening spread) plays out across the entire scroll, not
  // as a burst confined to the final transition.
  let diveProgress = 0;
  const scrollTrigger = ScrollTrigger.create({
    trigger: "#depth",
    start: "top top",
    endTrigger: "#eye",
    end: "bottom top",
    scrub: 1,
    onUpdate: (self) => {
      diveProgress = self.progress;
    },
  });

  const surfaceColor = new THREE.Color(DEEP_NAVY);
  const descendedColor = new THREE.Color(COLOR_DESCENDED);
  const tmpColor = new THREE.Color();

  let raf = 0;
  const clock = new THREE.Clock();
  // Not clock.elapsedTime: that's raw wall-clock time, and it jumps by
  // however long the tab was backgrounded the instant rAF resumes — a tab
  // switch away and back can add tens of seconds in a single frame. Since
  // age is computed as t - birthTime and compared against a 16–26s
  // lifespan, that one jump pushes every strand's age past its lifespan
  // simultaneously, respawning the entire population in the same frame —
  // all of them landing at the deepest, faintest point of a fresh life at
  // once. That reads as the scene going black. Accumulating from the
  // already-clamped per-frame dt instead means backgrounding can only ever
  // cost the single frame's worth of clamped time, never a pause-length
  // jump.
  let t = 0;

  function tick(): void {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    t += dt;
    const p = diveProgress;

    // Camera drift: never perfectly steady, so the dive always reads as
    // moving through a volume — even the instant scroll is paused — rather
    // than only when the scroll position itself changes.
    const [jx, jy] = curl3D(t * CAMERA_JITTER_SPEED, 41.3, 87.6);
    camera.position.set(
      cameraBase.x + jx * CAMERA_JITTER_AMOUNT,
      cameraBase.y + jy * CAMERA_JITTER_AMOUNT,
      THREE.MathUtils.lerp(CAMERA_Z_SURFACE, CAMERA_Z_DESCENDED, p),
    );
    camera.lookAt(0, 0, 0);

    const fog = scene.fog as THREE.FogExp2;
    fog.density = THREE.MathUtils.lerp(FOG_DENSITY_SURFACE, FOG_DENSITY_DESCENDED, p);
    tmpColor.copy(surfaceColor).lerp(descendedColor, p);
    fog.color.copy(tmpColor);
    renderer.setClearColor(tmpColor, 1);
    const margin = THREE.MathUtils.lerp(REPULSION_MARGIN, REPULSION_MARGIN_DESCENDED, p);
    const spreadT = THREE.MathUtils.clamp(p / DEPTH_SPREAD_FRACTION, 0, 1);
    // The retirement plane, recomputed every frame from the camera's actual
    // (already-jittered, already-dived) position this frame — this is what
    // keeps the whole life band travelling with the dive.
    const retireZ = camera.position.z - RETIRE_LEAD;

    for (const strand of strands) {
      const age = t - strand.birthTime;
      if (age < 0) {
        strand.mesh.fillOpacity = 0;
        continue;
      }
      if (age >= strand.lifespan) {
        respawn(strand, sdf, t, isCompact);
        strand.mesh.fillOpacity = 0;
        continue;
      }

      const fadeIn = THREE.MathUtils.clamp(age / FADE_IN_DURATION, 0, 1);
      const fadeOut = THREE.MathUtils.clamp((strand.lifespan - age) / FADE_OUT_DURATION, 0, 1);
      const eased = fadeIn * fadeIn * (3 - 2 * fadeIn);
      const lifeAlpha = eased * (fadeOut * fadeOut * (3 - 2 * fadeOut));

      // The strand's base depth, expressed as a distance in front of the
      // (moving) retirement plane. Generation zero eases from 0 (right at
      // the plane) out to its own settled offset as the reader scrolls (the
      // opening beat); every later generation instead rises continuously
      // from a far offset to a near-zero one over its own life, independent
      // of scroll entirely. Either way this is relative to retireZ, so the
      // whole band — and the whale repulsion, which reads baseZ against the
      // whale's fixed world z — travels down with the dive instead of being
      // left behind it.
      const offset = strand.isGenZero
        ? THREE.MathUtils.lerp(0, strand.homeOffset, spreadT)
        : THREE.MathUtils.lerp(LIFE_RANGE, 0, age / strand.lifespan);
      const baseZ = retireZ - offset;

      // Real 3D curl turbulence, sampled continuously for this strand's
      // whole life — depth never settles, even once generation zero's
      // opening spread has finished or a bubble is mid-rise.
      const time = t * strand.speed + strand.phase;
      const [cx, cy, cz] = curl3D(strand.x * NOISE_FREQ, strand.y * NOISE_FREQ, baseZ * NOISE_FREQ + time * 0.15);

      const zFalloff = Math.exp(-((baseZ - WHALE_Z) ** 2) / (2 * WHALE_Z_SPREAD ** 2));
      const [rx, ry] = repulsion(sdf, strand.x, strand.y, margin);

      // Curl noise gives local turbulence; a weak spring back to the
      // strand's spawn point keeps the field evenly spread instead of
      // drifting into fresh clusters over its life. The whale's repulsion
      // can still displace it near the margin.
      strand.x += (cx * FLOW_SPEED + rx * 2.2 * zFalloff + (strand.homeX - strand.x) * SPRING_K) * dt;
      strand.y += (cy * FLOW_SPEED + ry * 2.2 * zFalloff + (strand.homeY - strand.y) * SPRING_K) * dt;
      strand.z = baseZ + cz * Z_WOBBLE_AMOUNT;

      strand.mesh.position.set(strand.x, strand.y, strand.z);
      strand.mesh.scale.setScalar(THREE.MathUtils.lerp(BIRTH_SCALE_START, 1, eased));

      const distance = camera.position.distanceTo(strand.mesh.position);
      const depthFade = THREE.MathUtils.clamp(1 - (distance - NEAR_DIST) / (FAR_DIST - NEAR_DIST), 0.04, 1);
      strand.mesh.fillOpacity = strand.baseOpacity * depthFade * lifeAlpha;
    }

    renderer.render(scene, camera);
  }
  tick();

  return {
    dispose(): void {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      scrollTrigger.kill();
      for (const strand of strands) {
        strand.mesh.dispose();
        scene.remove(strand.mesh);
      }
      renderer.dispose();
    },
  };
}
