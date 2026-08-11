import * as THREE from "three";
import { Text, configureTextBuilder } from "troika-three-text";
// Bundled by Vite, so the URL is base-path-aware and survives the deploy to a
// Pages subpath — a literal "/fonts/…" would 404 there while working locally.
import fontURL from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff?url";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { curl3D } from "./noise";
import { buildWhaleSDF, whaleHalfExtents, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH, type SDFField } from "./sdf";
import { whaleDistanceAt, whaleDistanceScaleFor, whaleRepulsion, whaleSignedDistance } from "./whale-field";
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
// one call, before the first mesh is constructed, covering every strand —
// there is no path that can silently miss it.
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

// A strand's whole birth-peak-retirement arc is a pure function of SCROLL
// PROGRESS (`p`, 0..1 across the dive), not of wall-clock time.
//
// The previous version drove age off an accumulated real-time clock `t`,
// completely independent of scroll: strands were born, peaked and retired on
// a real-time schedule whether or not the reader was scrolling, or even
// looking at #depth yet. That produced exactly the reported symptoms —
// content already mid-cycle (or long since retired and randomly re-spawned)
// by the time the reader actually scrolled down, nothing tied to how far
// they'd scrolled, and no way to reverse it by scrolling back up.
//
// Instead, each strand gets a fixed `startP` (where in the 0..1 dive its arc
// begins) and `arcSpan` (how much of the dive its whole arc spans). Its
// lifeT is `clamp((p - startP) / arcSpan, 0, 1)` — a pure function of
// scroll position. Consequences, all for free from that one change:
//   - at p = 0 (before the reader has scrolled into #depth at all), every
//     startP > 0, so every strand's lifeT is exactly 0 — invisible. Nothing
//     shows until the reader actually scrolls; the surface stays just water.
//   - scrolling back up decreases p, which decreases lifeT exactly along the
//     same curve — the retreat is the same shape as the arrival, not a
//     separate one-directional fade that only ever plays forward.
//   - pacing is controlled directly in scroll distance: a wider arcSpan is a
//     more gradual entrance and exit, because it now costs more scrolling to
//     traverse, not more waiting.
// `t` (wall-clock) still exists below, but only for cosmetic motion — the
// curl-noise drift and camera jitter — never for whether something is alive.
const READER_START_MIN = 0.03;
const READER_START_MAX = 0.72;
const READER_ARC_SPAN_MIN = 0.22; // a wide span: a slow, deliberate arrival and exit
const READER_ARC_SPAN_MAX = 0.3;
const MOTE_START_MIN = 0.015;
const MOTE_START_MAX = 0.92;
const MOTE_ARC_SPAN_MIN = 0.05; // texture: quick, numerous, felt rather than tracked
const MOTE_ARC_SPAN_MAX = 0.09;

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

const DEEP_NAVY = 0x040814;
const CURRENT_BLUE = 0x4d6bfe;

// A strand's whole life is one arc, driven off its own normalised lifeT so
// the three phases are guaranteed to meet: arriving (small, faint, soft) →
// peak (full scale, full opacity, sharp — the readable window the concept
// depends on) → retiring (swelling past peak, fading, going soft again, as if
// passing too close to the lens to hold focus).
//
// Previously scale was driven by the fade-in alone and opacity by a separate
// fade-in × fade-out, so scale pinned at 1 for the rest of the strand's life
// and the exit had no softness at all. Two one-sided curves that were never
// designed to meet is exactly why they drifted apart.
//
// Readers and motes get their own timing rather than sharing one arc. A
// reader carries a full paper title or note — the actual subject of the
// concept — and needs to hold its peak long enough to be read, with an
// entrance and exit deliberate enough to register as an event. A mote is
// texture: numerous, small, meant to be felt rather than individually
// noticed, so it stays fast and its scale swing stays subtle. Without this
// split every strand read as a peer and the one thing the field is actually
// about — the research — never stood out from the grain around it.
// Fractions here are of the strand's OWN lifeT (0..1), which is itself now a
// fraction of arcSpan of the whole dive — so the true on-screen pace is
// birthPhase × arcSpan × (total scroll distance). Raised from the previous
// round (0.2/0.32) because "pops in too fast" was a real report: a reader's
// entrance previously cost about 6% of the whole dive's scroll distance,
// which reads as sudden even though the code called it an "arc". At ~0.32 of
// a ~0.26 arcSpan, an entrance now costs roughly 8-9% of the total scroll —
// still leaves most of the arc at genuine peak-focus reading time.
const READER_ARC: ArcTiming = {
  birthPhase: 0.32, // slower entrance than a mote's
  retirePhase: 0.38, // slower exit
  birthScale: 0.12, // arrives noticeably small
  retireScale: 2.8, // a pronounced pop passing the lens
};
const MOTE_ARC: ArcTiming = {
  birthPhase: 0.16, // fast — texture, not an event
  retirePhase: 0.3,
  birthScale: 0.55, // barely perceptible shrink
  retireScale: 1.35, // barely perceptible swell
};

// troika has no per-glyph fill blur: `outlineBlur` blurs a drawn *outline*,
// not the glyph fill, and real depth of field needs a postprocessing pass
// that is too big a risk this close to the deadline. So this is a deliberate
// fake, not true blur — as a strand leaves the readable window its sharp fill
// fades out while a blurred outline of the same colour fades in, leaving a
// soft glow where the letterforms were. Paired with the scale change (small
// at birth, oversized at retirement) the two together read as defocus.
const MAX_DEFOCUS_BLUR = "22%"; // of fontSize, at full defocus
const MAX_DEFOCUS_GLOW = 0.5; // outline opacity at full defocus
const USE_DEFOCUS_OUTLINE = true;
// A floor under the negative-space read.
//
// The absence is still the idea: the text genuinely bends around a volume it
// never enters, and that mechanic is untouched. But an absence is a weak
// signal — it depends on the field being dense enough, at the right depths,
// for a hole to have an edge — and two rounds of work on it have not produced
// something reliably visible. So this adds one positive signal underneath:
// a soft glow at the whale's own projected position and apparent size, in
// DeepSeek's actual brand blue rather than a generic accent. It is sized from
// the same cone projection the text repulsion uses, so if the geometry is ever
// wrong the glow is wrong in exactly the same way and the disagreement between
// hole and glow is itself diagnostic.
// Two rounds of raising this from 0.06 (invisible) to 0.22 (still reported
// invisible against a dense, brightly-lit text field) — the glow was losing a
// brightness contest against the reader/mote population around it, not just
// being generically too dim. Pushed further and the additive falloff spread
// wider (GLOW_SPREAD) so the whale reads as an unmissable presence rather
// than something to hunt for. GLOW_OPACITY_EYE keeps a growth ratio (~2x)
// so it still reads as closing in, not switching on abruptly at the eye.
const GLOW_OPACITY_SURFACE = 0.4;
const GLOW_OPACITY_EYE = 0.85;
const GLOW_SPREAD = 2.2; // how far the falloff reaches past the silhouette

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
  /** Dive progress (0..1) at which this strand's arc begins. */
  startP: number;
  /** Fraction of dive progress the whole birth-peak-retirement arc spans. */
  arcSpan: number;
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

/** Hermite ease on an already-clamped 0..1 value. */
function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

export interface StrandArc {
  /** 1 through the readable middle, 0 at both ends of life. */
  focus: number;
  /** Below 1 arriving, exactly 1 at peak, above 1 while retiring. */
  scale: number;
}

export interface ArcTiming {
  /** Fraction of life spent arriving. */
  birthPhase: number;
  /** Fraction of life spent passing the lens on the way out. */
  retirePhase: number;
  /** Scale at the moment of birth, below 1. */
  birthScale: number;
  /** Scale at the moment of retirement, above 1. */
  retireScale: number;
}

/**
 * The whole birth → peak → retirement arc as one pure function of the
 * strand's own normalised age and its timing.
 *
 * Extracted so it can be tested: the recurring failure here has been the
 * phases drifting apart (scale driven off one curve, opacity off another, the
 * two never designed to meet), which is invisible in a screenshot and obvious
 * in an assertion. `arrive` and `linger` are deliberately derived from the one
 * `lifeT` so the middle is guaranteed to be both fully arrived and not yet
 * retiring.
 *
 * `timing` is a parameter rather than a module-scope constant so readers and
 * motes can each get their own feel — a reader's arrival is slow and its
 * scale swing pronounced, a mote's is quick and barely perceptible — without
 * `strandArc` itself knowing anything about which tier called it. It stays a
 * pure function of its inputs either way.
 */
export function strandArc(lifeT: number, timing: ArcTiming): StrandArc {
  const arrive = smoothstep(Math.min(Math.max(lifeT / timing.birthPhase, 0), 1));
  const linger = smoothstep(Math.min(Math.max((1 - lifeT) / timing.retirePhase, 0), 1));
  return {
    focus: Math.min(arrive, linger),
    // Multiplied, not blended: at peak both terms are exactly 1, so each end
    // owns its own half of the arc without fighting the other.
    scale:
      (timing.birthScale + (1 - timing.birthScale) * arrive) * (1 + (timing.retireScale - 1) * (1 - linger)),
  };
}

/**
 * A radial falloff, built as raw pixel data rather than drawn on a 2D canvas
 * so the scene has no dependency on a canvas context it doesn't otherwise
 * need. White with a soft alpha ramp; the colour comes from the material, so
 * the brand blue lives in exactly one place.
 */
function makeGlowTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const falloff = Math.max(0, 1 - Math.hypot(nx, ny));
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // Squared on top of the ease so the centre stays concentrated and the
      // edge dissolves, rather than reading as a flat disc with a hard rim.
      data[i + 3] = Math.round(smoothstep(falloff) * falloff * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
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

  /** A strand's own window of dive progress: where its arc starts, and how
   * much scroll distance the whole birth-peak-retirement cycle spans. */
  function scheduleFor(isReader: boolean): { startP: number; arcSpan: number } {
    const arcSpan = isReader ? rand(READER_ARC_SPAN_MIN, READER_ARC_SPAN_MAX) : rand(MOTE_ARC_SPAN_MIN, MOTE_ARC_SPAN_MAX);
    const startMin = isReader ? READER_START_MIN : MOTE_START_MIN;
    const startMax = isReader ? READER_START_MAX : MOTE_START_MAX;
    // Clamp so startP + arcSpan never overshoots 1 — a strand whose arc was
    // still climbing when the dive ended would never reach its own peak.
    const startP = rand(startMin, Math.min(startMax, 1 - arcSpan));
    return { startP, arcSpan };
  }

  // Additive so it reads as light in water rather than a painted shape, and
  // depthWrite off so the text field still sorts through it. Sized in world
  // units below; because it sits at exactly `whaleDistance` from the camera —
  // the depth where whale space and world space coincide (see whale-field.ts)
  // — the silhouette's own half-extents are already its world size there.
  // Holds the whale's apparent size steady across aspect ratios — without it
  // a portrait phone gets a whale wider than its own viewport (see
  // whaleDistanceScaleFor). Read once here and reused for both the repulsion
  // cone and the glow, so the two cannot disagree.
  const whaleDistanceScale = whaleDistanceScaleFor(canvas.clientWidth / canvas.clientHeight);

  const { halfWidth: whaleHalfWidth, halfHeight: whaleHalfHeight } = whaleHalfExtents();
  const glowMaterial = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(),
    color: CURRENT_BLUE,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMaterial);
  // Drawn before the text so strands read as suspended in the light, not
  // washed over by it.
  glow.renderOrder = -1;
  glow.scale.set(whaleHalfWidth * 2 * GLOW_SPREAD, whaleHalfHeight * 2 * GLOW_SPREAD, 1);
  scene.add(glow);

  function makeStrand(isReader: boolean): Strand {
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
    // No drawn outline — the outline channel is used purely as the blurred
    // stand-in for defocus at both ends of life (see MAX_DEFOCUS_BLUR), so it
    // matches the fill colour and is driven entirely from the tick.
    mesh.outlineWidth = 0;
    mesh.outlineColor = CURRENT_BLUE;
    mesh.outlineOpacity = 0;
    mesh.outlineBlur = 0;
    mesh.fillOpacity = 0;
    mesh.sync();

    const { startP, arcSpan } = scheduleFor(isReader);
    // Placed at the depth its arc will start from, at the whale's position at
    // that same startP — both the strand and the whale it must avoid are
    // evaluated at the progress where this strand actually begins existing.
    const whaleDistance = whaleDistanceAt(startP) * whaleDistanceScale;
    const depth = RETIRE_LEAD + LIFE_RANGE;
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
      startP,
      arcSpan,
      isReader,
    };
  }

  const strands: Strand[] = [];
  for (let i = 0; i < (isCompact ? READERS_COMPACT : READERS_FULL); i++) {
    strands.push(makeStrand(true));
  }
  for (let i = 0; i < (isCompact ? MOTES_COMPACT : MOTES_FULL); i++) {
    strands.push(makeStrand(false));
  }
  for (const strand of strands) {
    scene.add(strand.mesh);
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
  // `t` no longer decides whether anything is alive — that's `p` (dive
  // progress) now, a pure function of scroll position, not time. `t` still
  // drives purely cosmetic motion: curl-noise drift on strands that ARE
  // active, and the camera's idle jitter. Accumulated from the per-frame
  // delta (clamped to 1/30s) rather than read as clock.elapsedTime, so a
  // backgrounded tab resuming after a long pause doesn't jump this by the
  // whole gap — it only ever advances by one clamped frame's worth, however
  // long the tab slept.
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

    const whaleDistance = whaleDistanceAt(p) * whaleDistanceScale;
    const retireZ = camera.position.z - RETIRE_LEAD;

    // The whale sits on the camera's own axis at `whaleDistance` ahead — the
    // same anchor the repulsion cone is built from, so the glow and the hole
    // can never disagree about where the whale is. It grows on screen as the
    // dive closes because the distance shrinks, not because it is scaled up.
    glow.position.set(0, 0, camera.position.z - whaleDistance);
    glowMaterial.opacity = THREE.MathUtils.lerp(GLOW_OPACITY_SURFACE, GLOW_OPACITY_EYE, p);

    for (const strand of strands) {
      // Outside its own [startP, startP + arcSpan] window a strand doesn't
      // exist yet, or has already finished existing — not "invisible", never
      // instantiated into the scene's visible state at all. This is the gate
      // that makes the surface read as pure water before any scrolling: at
      // p = 0 every strand's startP > 0, so this branch is taken for all of
      // them and nothing whatsoever is drawn.
      //
      // Without this explicit gate, strandArc's own math still leaves a
      // problem at the boundary: at lifeT clamped to exactly 0, focus is 0
      // but defocus (1 - focus) is 1, so the "blurred glow standing in for
      // the sharp glyph" would render at full strength for a strand that
      // hasn't started yet — a ghost glowing before its own birth. Gating on
      // the window itself, not just on strandArc's output, avoids that.
      if (p < strand.startP || p > strand.startP + strand.arcSpan) {
        strand.mesh.fillOpacity = 0;
        strand.mesh.outlineOpacity = 0;
        continue;
      }

      const lifeT = THREE.MathUtils.clamp((p - strand.startP) / strand.arcSpan, 0, 1);

      const { focus, scale } = strandArc(lifeT, strand.isReader ? READER_ARC : MOTE_ARC);

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

      strand.mesh.scale.setScalar(scale);

      const distance = camera.position.distanceTo(strand.mesh.position);
      const depthFade = THREE.MathUtils.clamp(1 - (distance - NEAR_DIST) / (FAR_DIST - NEAR_DIST), 0.03, 1);
      const visible = strand.baseOpacity * depthFade;

      // Sharp fill in the readable window; a soft blurred glow of the same
      // colour taking its place at both ends. See MAX_DEFOCUS_BLUR above —
      // this is a stand-in for defocus, not real blur.
      const defocus = 1 - focus;
      strand.mesh.fillOpacity = visible * focus;
      if (USE_DEFOCUS_OUTLINE) {
        strand.mesh.outlineOpacity = visible * defocus * MAX_DEFOCUS_GLOW;
        strand.mesh.outlineBlur = defocus === 0 ? 0 : MAX_DEFOCUS_BLUR;
      }
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
