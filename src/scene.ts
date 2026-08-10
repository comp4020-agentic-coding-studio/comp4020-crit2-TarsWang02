import * as THREE from "three";
import { Text, configureTextBuilder } from "troika-three-text";
// Bundled by Vite, so the URL is base-path-aware and survives the deploy to a
// Pages subpath — a literal "/fonts/…" would 404 there while working locally.
import fontURL from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff?url";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { curl3D } from "./noise";
import { buildWhaleSDF, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH, type SDFField } from "./sdf";
import { whaleDistanceAt, whaleRepulsion, whaleSignedDistance } from "./whale-field";
import { papers } from "./papers";

gsap.registerPlugin(ScrollTrigger);

// Self-host the font, at module scope so it is set before any Text exists.
//
// This is the whole field's failure mode, not a nicety. troika 0.52.5 defaults
// both `Text.font` and `CONFIG.defaultFontURL` to null, and with both null the
// font list it hands the worker is *empty* — so it falls back to fetching
// glyphs from `cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver` at runtime.
// That fetch failing produces no error and no glyph geometry: every mesh syncs
// "successfully" with nothing in it, and the entire text field renders blank
// while the code looks correct. It reached a browser that could resolve
// jsdelivr and one that could not, which is exactly why it read as "works for
// me, invisible for you".
//
// configureTextBuilder is used rather than setting `mesh.font` per strand:
// one call, before the first mesh is constructed, covering every strand and
// every respawn — there is no path that can silently miss it.
configureTextBuilder({ defaultFontURL: fontURL });

// How hard the whale's absence is defended. The repulsion now applies at
// every depth (see whale-field.ts), so this can be firm without any single
// layer of the field being flung about.
const REPULSION_MARGIN = 1.1;
const REPULSION_STRENGTH = 3.4;

// Scrolling is descending: the camera sinks, the water darkens and thickens,
// and the whale closes — all driven by scroll progress through #depth plus
// the eye, not by time.
const CAMERA_Z_SURFACE = 9;
const CAMERA_Z_DESCENDED = 1.4;
const FOG_DENSITY_SURFACE = 0.055;
// FogExp2 falls off as exp(-(density·distance)²) — steep. At the ~15 units a
// far strand sits from the camera, 0.2 leaves exp(-9) ≈ 0.0001 (invisible at
// any opacity); 0.085 leaves exp(-1.6) ≈ 0.2, murky but real. Tuned against
// what the pixel probe actually reports at the descended camera position.
const FOG_DENSITY_DESCENDED = 0.085;
const COLOR_DESCENDED = 0x000103;

// Gentle, continuous camera drift — real underwater camera movement is never
// perfectly steady, and this keeps the dive reading as passing through a
// volume even when the scroll is momentarily still.
const CAMERA_JITTER_AMOUNT = 0.2;
const CAMERA_JITTER_SPEED = 0.12;

// Every strand is a bubble with a life: born small, faint and deep, rising
// continuously toward the camera, fading out and retiring as it arrives.
// Life bounds are relative to the camera's current z, so the band travels
// with the dive and the camera is always descending into fresh text.
const RETIRE_LEAD = 1.6;
const LIFE_RANGE = 15;
const LIFESPAN_MIN = 15;
const LIFESPAN_MAX = 27;

// Density. A silhouette is an edge, and an edge needs enough elements to be
// drawn by their absence — you cannot see a hole in something that is mostly
// hole already. Two tiers rather than one uniform swarm: `readers` carry
// whole paper titles and notes at a size that is genuinely readable (the
// concept, and the spec's real-content requirement); `motes` are short real
// phrases at small scale, and there are an order of magnitude more of them.
// They are what actually gives the field a definite edge. Distant motes
// degrade into texture, which the brief allows, but near ones still resolve
// into real words from real DeepSeek research.
const READERS_FULL = 26;
const READERS_COMPACT = 12;
const MOTES_FULL = 420;
const MOTES_COMPACT = 150;
const INITIAL_STAGGER = 5;

const DEEP_NAVY = 0x040814;
const CURRENT_BLUE = 0x4d6bfe;

const FADE_IN_DURATION = 1.5;
const FADE_OUT_DURATION = 2.2;
const BIRTH_SCALE_START = 0.2;
const NOISE_FREQ = 0.16;
const FLOW_SPEED = 0.75;
const SPRING_K = 0.5;
const Z_WOBBLE_AMOUNT = 0.9;

// Opacity by distance from the camera, not by world z — the camera moves, so
// what matters is how far a strand actually is from the lens right now.
const NEAR_DIST = 2.5;
const FAR_DIST = 17;

interface Strand {
  mesh: Text;
  x: number;
  y: number;
  z: number;
  homeX: number;
  homeY: number;
  phase: number;
  speed: number;
  baseOpacity: number;
  birthTime: number;
  lifespan: number;
  isReader: boolean;
}

const SPEC_FRAGMENTS = [
  "671B total · 37B activated",
  "256 experts · 8 active",
  "5.5% activation ratio",
  "128,000 token context",
  "14.8 trillion tokens",
  "93.3% smaller KV cache",
  "2.788M H800 GPU hours",
  "338 programming languages",
];

/**
 * Short phrases lifted from the real corpus — consecutive words of actual
 * paper titles and notes — so even the fine grain of the field is DeepSeek's
 * own research rather than filler.
 */
function buildMotePool(): string[] {
  const pool: string[] = [...SPEC_FRAGMENTS];
  for (const paper of papers) {
    for (const source of [paper.title, paper.note]) {
      const words = source.replace(/[.,]/g, "").split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i += 2) {
        const phrase = words.slice(i, i + 3).join(" ");
        if (phrase.length > 3) pool.push(phrase);
      }
    }
  }
  return pool;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/**
 * A spawn point clear of the whale's projected footprint at this strand's own
 * depth. Rejection sampling: cheaper and more legible than solving the cone
 * analytically, and it fails safe — if the whale has loomed large enough to
 * cover the whole field at this depth, the strand is placed at the rim rather
 * than looping forever.
 */
function spawnClearOfWhale(
  sdf: SDFField,
  depthAhead: number,
  whaleDistance: number,
): [number, number] {
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = rand(-WORLD_HALF_WIDTH, WORLD_HALF_WIDTH);
    const y = rand(-WORLD_HALF_HEIGHT, WORLD_HALF_HEIGHT);
    if (whaleSignedDistance(sdf, x, y, depthAhead, whaleDistance) > REPULSION_MARGIN) {
      return [x, y];
    }
  }
  const angle = rand(0, Math.PI * 2);
  return [Math.cos(angle) * WORLD_HALF_WIDTH, Math.sin(angle) * WORLD_HALF_HEIGHT];
}

export interface SceneHandle {
  dispose: () => void;
}

export function createScene(canvas: HTMLCanvasElement): SceneHandle {
  const isCompact = window.innerWidth < 700;
  const dpr = Math.min(window.devicePixelRatio || 1, isCompact ? 1.5 : 2);
  const motePool = buildMotePool();

  // preserveDrawingBuffer: without it, reading the canvas back (the pixel
  // probe in scripts/probe-whale.js, devtools, screenshot tooling) races the
  // browser clearing the buffer and can report an empty frame when the scene
  // is fine — a false signal that makes a real bug report impossible to
  // trust. Worth the small cost for a check this concept depends on.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(DEEP_NAVY, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(DEEP_NAVY, FOG_DENSITY_SURFACE);

  const camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 120);
  const cameraBase = new THREE.Vector3(0, 0, CAMERA_Z_SURFACE);
  camera.position.copy(cameraBase);
  camera.lookAt(0, 0, 0);

  const sdf = buildWhaleSDF();

  function makeStrand(isReader: boolean, staggeredBirth: boolean): Strand {
    const mesh = new Text();
    if (isReader) {
      const paper = pick(papers);
      mesh.text = Math.random() < 0.55 ? paper.title : paper.note;
      mesh.fontSize = rand(0.26, 0.36);
      mesh.maxWidth = 7;
    } else {
      mesh.text = pick(motePool);
      mesh.fontSize = rand(0.1, 0.17);
    }
    mesh.color = CURRENT_BLUE;
    mesh.anchorX = "center";
    mesh.anchorY = "middle";
    mesh.letterSpacing = 0.01;
    mesh.outlineWidth = 0;
    mesh.fillOpacity = 0;
    mesh.sync();

    const whaleDistance = whaleDistanceAt(0);
    const depth = rand(RETIRE_LEAD, RETIRE_LEAD + LIFE_RANGE);
    const [x, y] = spawnClearOfWhale(sdf, depth, whaleDistance);

    return {
      mesh,
      x,
      y,
      z: CAMERA_Z_SURFACE - depth,
      homeX: x,
      homeY: y,
      phase: rand(0, 1000),
      speed: rand(0.35, 0.75),
      baseOpacity: isReader ? rand(0.6, 1) : rand(0.35, 0.8),
      birthTime: staggeredBirth ? rand(0, INITIAL_STAGGER) : 0,
      // Spread generation zero across its lifespan so the whole population
      // doesn't retire together and leave the field momentarily bare.
      lifespan: rand(LIFESPAN_MIN, LIFESPAN_MAX),
      isReader,
    };
  }

  const strands: Strand[] = [];
  for (let i = 0; i < (isCompact ? READERS_COMPACT : READERS_FULL); i++) {
    strands.push(makeStrand(true, true));
  }
  for (let i = 0; i < (isCompact ? MOTES_COMPACT : MOTES_FULL); i++) {
    strands.push(makeStrand(false, true));
  }
  for (const strand of strands) {
    // Generation zero starts partway through its life so retirements are
    // staggered from the outset rather than arriving in one wave.
    strand.birthTime = -rand(0, strand.lifespan * 0.9);
    scene.add(strand.mesh);
  }

  /**
   * Retires a strand and rebirths it deep and clear of the whale. The text is
   * deliberately left alone: changing it would force a troika sync(), and at
   * this population that is a few hundred re-layouts a minute for variety the
   * field already has from its size.
   */
  function respawn(strand: Strand, now: number, whaleDistance: number): void {
    const depth = RETIRE_LEAD + LIFE_RANGE;
    const [x, y] = spawnClearOfWhale(sdf, depth, whaleDistance);
    strand.x = x;
    strand.y = y;
    strand.homeX = x;
    strand.homeY = y;
    strand.phase = rand(0, 1000);
    strand.speed = rand(0.35, 0.75);
    strand.birthTime = now;
    strand.lifespan = rand(LIFESPAN_MIN, LIFESPAN_MAX);
  }

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  // One continuous dive spanning the whole research read plus the eye, so the
  // descent plays out across the entire scroll rather than as a burst in the
  // final transition.
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
  // Not clock.elapsedTime: that is raw wall-clock time, and it jumps by the
  // whole pause the instant a backgrounded tab resumes. Since age is compared
  // against a 15–27s lifespan, one such jump ages the entire population past
  // its lifespan in a single frame, respawning everything at once — the whole
  // field lands at its deepest, faintest moment together and the scene reads
  // as having gone black. Accumulating from the already-clamped per-frame dt
  // costs at most one frame of time no matter how long the tab slept.
  let t = 0;

  function tick(): void {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    t += dt;
    const p = diveProgress;

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

    const whaleDistance = whaleDistanceAt(p);
    const retireZ = camera.position.z - RETIRE_LEAD;

    for (const strand of strands) {
      const age = t - strand.birthTime;
      if (age >= strand.lifespan) {
        respawn(strand, t, whaleDistance);
        strand.mesh.fillOpacity = 0;
        continue;
      }

      const lifeT = age / strand.lifespan;
      const fadeIn = THREE.MathUtils.clamp(age / FADE_IN_DURATION, 0, 1);
      const fadeOut = THREE.MathUtils.clamp((strand.lifespan - age) / FADE_OUT_DURATION, 0, 1);
      const eased = fadeIn * fadeIn * (3 - 2 * fadeIn);
      const lifeAlpha = eased * (fadeOut * fadeOut * (3 - 2 * fadeOut));

      // Depth is a distance in front of the moving retirement plane, easing
      // from the far end of the band to zero across the strand's life.
      const depthAhead = RETIRE_LEAD + LIFE_RANGE * (1 - lifeT);
      const baseZ = retireZ - LIFE_RANGE * (1 - lifeT);

      const time = t * strand.speed + strand.phase;
      const [cx, cy, cz] = curl3D(strand.x * NOISE_FREQ, strand.y * NOISE_FREQ, baseZ * NOISE_FREQ + time * 0.15);

      // The whale, at every depth. Applied to the strand and to the point it
      // springs back toward: without the latter the spring would drag it
      // straight back into the hole it was just pushed out of.
      const [rx, ry] = whaleRepulsion(sdf, strand.x, strand.y, depthAhead, whaleDistance, REPULSION_MARGIN);
      const [hrx, hry] = whaleRepulsion(sdf, strand.homeX, strand.homeY, depthAhead, whaleDistance, REPULSION_MARGIN);
      strand.homeX += hrx * REPULSION_STRENGTH * dt;
      strand.homeY += hry * REPULSION_STRENGTH * dt;

      strand.x += (cx * FLOW_SPEED + rx * REPULSION_STRENGTH + (strand.homeX - strand.x) * SPRING_K) * dt;
      strand.y += (cy * FLOW_SPEED + ry * REPULSION_STRENGTH + (strand.homeY - strand.y) * SPRING_K) * dt;
      strand.z = baseZ + cz * Z_WOBBLE_AMOUNT;

      strand.mesh.position.set(strand.x, strand.y, strand.z);
      strand.mesh.scale.setScalar(THREE.MathUtils.lerp(BIRTH_SCALE_START, 1, eased));

      const distance = camera.position.distanceTo(strand.mesh.position);
      const depthFade = THREE.MathUtils.clamp(1 - (distance - NEAR_DIST) / (FAR_DIST - NEAR_DIST), 0.03, 1);
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
