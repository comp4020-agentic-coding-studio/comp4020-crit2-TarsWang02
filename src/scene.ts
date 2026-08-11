import * as THREE from "three";
import { Text, configureTextBuilder } from "troika-three-text";
// Bundled by Vite, so the URL is base-path-aware and survives the deploy to a
// Pages subpath — a literal "/fonts/…" would 404 there while working locally.
import fontURL from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff?url";
// DeepSeek's own mark, pulled from the paths their own homepage ships inline
// (view-source on deepseek.com, the <g clip-path="url(#clip0_logo)"> group) —
// not a hand-drawn stand-in. See PROCESS.md for how it was extracted.
import logoURL from "./assets/deepseek-mark.svg?url";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { curl3D } from "./noise";
import { buildWhaleSDF, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH, type SDFField } from "./sdf";
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
// 0, not a small positive value: a portion of motes should already be
// mid-arc the instant the reader starts scrolling at all, so the ambient
// "sea surface" texture has some immediate density rather than a beat of
// nothing before the field ramps up. Readers still start well after 0 —
// only the ambient layer, not the main content, is present from the first
// scroll.
const MOTE_START_MIN = 0;
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
const MOTES_FULL = 520; // raised from 420 — the sea surface reads too sparse at the old count
const MOTES_COMPACT = 190;

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
// The absence (text genuinely bending around a volume it never enters) is
// still there and untouched — the exclusion cone below still reads `sdf`, the
// same hand-authored silhouette it always has. What sits *visibly* in that
// cone is two layers of DeepSeek's own mark (see loadLogoTextures), not the
// silhouette itself: an ambient, undefined glow present through most of the
// dive, and the actual logo resolving out of it only near the eye. A shape
// legible from the very first frame gave nothing away to arrive at — the
// concept is a thing inferred, then finally seen, not a sticker.
const GLOW_OPACITY_SURFACE = 0.4; // the soft layer's floor — present, not yet a shape
const GLOW_OPACITY_EYE = 0.85; // the soft layer's ceiling, reached as the logo resolves
// #eye's own trigger (see eye.ts) starts closing once #depth's 400vh has
// scrolled past — around p ≈ 0.645 of this dive, given #depth and #eye's
// relative heights — and the iris is fully opaque (clip-path circle at its
// own 100% progress) about 0.84 of dive progress: it does not track a fixed
// dive-progress value, so this is calibrated against the current #depth/#eye
// height ratio, not exact. The window below is deliberately entirely BEFORE
// that: resolving the mark any later would finish sharpening behind a
// screen the iris has already turned solid black, which defeats "align the
// eye with the mask" — the reveal has to still be visible when it lands.
const LOGO_RESOLVE_START = 0.5;
const LOGO_RESOLVE_END = 0.64; // fully resolved just before #eye starts closing over it
const LOGO_SHARP_MAX_OPACITY = 1;

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

const HERO_BREATHE_CYCLES = 3; // gentle oscillations across one line's own plateau
const HERO_BREATHE_DEPTH = 0.15; // how far the breathing dips below full opacity
const HERO_MAX_BLUR_PX = 14; // CSS blur at full defocus, both ends of a line's arc

// One statement at a time, fixed on screen, cycling as the dive proceeds —
// not one static tagline sitting alone. Every `heading`/`body` pair below is
// DeepSeek's own wording, pulled verbatim from deepseek.com (view-source, not
// paraphrased) — see PROCESS.md for the source of each. `startP`/`arcSpan`
// give each line its own non-overlapping window of dive progress, the same
// scheduling idea `scheduleFor` uses for strands: nothing shows before its
// window, and the gaps between windows are deliberate — stretches of just
// water and the floating research, so a line reads as an event rather than
// permanent chrome.
//
// All four windows end by p = 0.63, comfortably before #eye's own clip-path
// trigger starts closing over the canvas at p ≈ 0.645 (exactly 400/620 —
// #depth is 400vh, #eye is 220vh, and both scale with viewport height the
// same way, so that ratio holds regardless of viewport size). Text scheduled
// any later would fade out, or simply sit, behind an iris the reader can no
// longer see through — the approach to the eye past that point is left
// wordless on purpose, for the mark itself (see LOGO_RESOLVE_START/END) to
// have the close alone.
interface NarrationLine {
  heading: string;
  body: string;
  startP: number;
  arcSpan: number;
}
const NARRATION_LINES: NarrationLine[] = [
  {
    heading: "探索未至之境",
    body: "Into the unknown — DeepSeek's own line. The current below is real: DeepSeek's own published research, in motion, bending around a shape it never shows you.",
    startP: 0,
    arcSpan: 0.12,
  },
  {
    heading: "深度求索",
    body: "DeepSeek's own Chinese name, literally — to seek by going deep. It is the closest thing this site has to a thesis statement, and it already existed.",
    startP: 0.17,
    arcSpan: 0.12,
  },
  {
    heading: "我们投身于探索 AGI 的本质",
    body: "From DeepSeek's own careers page: “devoted to exploring the essence of AGI.” Not written for this redesign — theirs.",
    startP: 0.34,
    arcSpan: 0.12,
  },
  {
    heading: "共赴星辰大海",
    body: "DeepSeek's own recruiting line — onward, to the stars and the sea. The dive ends here; so does their own metaphor, right as the mark itself finally resolves.",
    startP: 0.51,
    arcSpan: 0.12,
  },
];

// Shared by every narration line: arrive small, blurred and faint; hold a
// readable plateau; leave larger, blurred and faint again — the same
// birth-peak-retirement shape `strandArc` gives every strand, reused rather
// than reinvented, so the main statement gets the identical "grow, go
// transparent, go soft" exit the concept asks for everywhere else.
const NARRATION_ARC: ArcTiming = {
  birthPhase: 0.22,
  retirePhase: 0.32,
  birthScale: 0.82, // arrives slightly small
  retireScale: 1.6, // leaves noticeably larger — passing close, like a strand
};

export interface NarrationState {
  activeIndex: number; // -1 when no line is in its window
  opacity: number;
  scale: number;
  blurPx: number;
}

/**
 * Which narration line (if any) owns dive progress `p`, and its own
 * opacity/scale/blur — reusing `strandArc` so the hero text gets the exact
 * defocus behaviour a strand gets, not a separate opacity-only fade.
 */
export function narrationStateAt(p: number): NarrationState {
  const activeIndex = NARRATION_LINES.findIndex(
    (line) => p >= line.startP && p <= line.startP + line.arcSpan,
  );
  if (activeIndex === -1) {
    return { activeIndex: -1, opacity: 0, scale: 1, blurPx: 0 };
  }
  const line = NARRATION_LINES[activeIndex]!;
  const lifeT = (p - line.startP) / line.arcSpan;
  const { focus, scale } = strandArc(lifeT, NARRATION_ARC);
  const breathe = 1 - HERO_BREATHE_DEPTH * (0.5 - 0.5 * Math.cos(lifeT * Math.PI * 2 * HERO_BREATHE_CYCLES));
  return { activeIndex, opacity: focus * breathe, scale, blurPx: HERO_MAX_BLUR_PX * (1 - focus) };
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
 * Fallback only, if `loadLogoTextures` below ever fails to load the real
 * asset — an invisible whale is a worse failure than a hand-authored
 * stand-in. Built straight from `sdf`'s own distance grid, so at least it is
 * pixel-for-pixel the exact shape the text repulsion bends around. Deep
 * inside the silhouette (very negative distance) is fully opaque; the
 * boundary softens over `EDGE_SOFTNESS` grid cells so the edge glows rather
 * than cutting hard.
 */
const EDGE_SOFTNESS = 5; // grid cells of soft falloff at the silhouette's edge
function makeWhaleTexture(sdf: SDFField): THREE.DataTexture {
  const { width, height, data } = sdf;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const distance = data[i]!; // grid cells; negative = inside the silhouette
    const t = THREE.MathUtils.clamp(1 - distance / EDGE_SOFTNESS, 0, 1);
    const alpha = smoothstep(t);
    const idx = i * 4;
    rgba[idx] = 255;
    rgba[idx + 1] = 255;
    rgba[idx + 2] = 255;
    rgba[idx + 3] = Math.round(alpha * 255);
  }
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

// DeepSeek's own mark, in its native coordinate space (the viewBox
// src/assets/deepseek-mark.svg was cropped to, taken straight from
// deepseek.com's own inline SVG). LOGO_EYE_U/V are the small eye loop's own
// centre within that box — read directly off the path's control points, not
// eyeballed from a render — so the mark can be drawn with its actual eye at
// the texture's centre, which is where .iris (see eye.ts) always opens from.
const LOGO_VIEWBOX = { x: 0.163086, y: 1.75, width: 26.634, height: 19.6 };
const LOGO_EYE_U = (14.4659 - LOGO_VIEWBOX.x) / LOGO_VIEWBOX.width;
const LOGO_EYE_V = (11.2489 - LOGO_VIEWBOX.y) / LOGO_VIEWBOX.height;

const LOGO_CANVAS_SIZE = 1024;
const LOGO_DRAW_SCALE = 0.62; // fraction of the canvas the mark's own width fills
const LOGO_SOFT_BLUR_PX = 46; // canvas-filter blur for the "undefined light" layer

/**
 * Two renders of the same mark, both with its eye at the canvas centre so
 * both line up with the plane they'll be mapped onto and with `.iris` behind
 * it: a sharp one (the mark as DeepSeek draws it) and a heavily blurred one
 * (a formless cluster of light — what the dive shows before the mark has any
 * business being recognisable). The tick loop cross-fades between them by
 * dive progress, rather than showing the sharp mark from frame one.
 */
function loadLogoTextures(): Promise<{ sharp: THREE.CanvasTexture; soft: THREE.CanvasTexture }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const iconAspect = LOGO_VIEWBOX.width / LOGO_VIEWBOX.height;
      const drawWidth = LOGO_CANVAS_SIZE * LOGO_DRAW_SCALE;
      const drawHeight = drawWidth / iconAspect;
      const drawX = LOGO_CANVAS_SIZE / 2 - LOGO_EYE_U * drawWidth;
      const drawY = LOGO_CANVAS_SIZE / 2 - LOGO_EYE_V * drawHeight;

      const sharpCanvas = document.createElement("canvas");
      sharpCanvas.width = LOGO_CANVAS_SIZE;
      sharpCanvas.height = LOGO_CANVAS_SIZE;
      sharpCanvas.getContext("2d")!.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      const softCanvas = document.createElement("canvas");
      softCanvas.width = LOGO_CANVAS_SIZE;
      softCanvas.height = LOGO_CANVAS_SIZE;
      const softCtx = softCanvas.getContext("2d")!;
      softCtx.filter = `blur(${LOGO_SOFT_BLUR_PX}px)`;
      softCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      resolve({ sharp: new THREE.CanvasTexture(sharpCanvas), soft: new THREE.CanvasTexture(softCanvas) });
    };
    img.onerror = () => reject(new Error("Failed to load DeepSeek mark SVG"));
    img.src = logoURL;
  });
}

/** How resolved the sharp mark is at dive progress `p` — 0 for most of the
 * dive (just the soft, undefined layer shows), ramping up only in the
 * approach to the eye. Exported and pure for the same reason `strandArc` is:
 * a "when does it become recognisable" regression belongs in an assertion,
 * not a screenshot. */
export function logoResolveAmount(p: number): number {
  return smoothstep(
    THREE.MathUtils.clamp((p - LOGO_RESOLVE_START) / (LOGO_RESOLVE_END - LOGO_RESOLVE_START), 0, 1),
  );
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

  // Additive so it reads as light in water rather than a flat painted shape,
  // and depthWrite off so the text field still sorts through it. Sized in
  // world units below; because it sits at exactly `whaleDistance` from the
  // camera — the depth where whale space and world space coincide (see
  // whale-field.ts) — the SDF grid's own world footprint (WORLD_HALF_WIDTH ×
  // WORLD_HALF_HEIGHT) is the same footprint the exclusion cone occupies, so
  // the visible glow and the invisible hole cover the same region even though
  // they no longer come from the same texture.
  // Holds the whale's apparent size steady across aspect ratios — without it
  // a portrait phone gets a whale wider than its own viewport (see
  // whaleDistanceScaleFor). Read once here and reused for both the repulsion
  // cone and both glow planes, so none of the three can disagree.
  const whaleDistanceScale = whaleDistanceScaleFor(canvas.clientWidth / canvas.clientHeight);

  // Two planes, same position and size every frame, cross-faded by
  // logoResolveAmount: `glowSoft` is the undefined cluster of light the dive
  // shows for most of its length; `glowSharp` is DeepSeek's actual mark,
  // fading in only in the approach to the eye. Both start fully transparent
  // — `logosReady` below holds them there until loadLogoTextures resolves, so
  // there's no frame of a flat white quad while the async load is in flight.
  function makeGlowMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const material = new THREE.MeshBasicMaterial({
      color: CURRENT_BLUE,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    // Drawn before the text so strands read as suspended in the light, not
    // washed over by it.
    mesh.renderOrder = -1;
    mesh.scale.set(WORLD_HALF_WIDTH * 2, WORLD_HALF_HEIGHT * 2, 1);
    scene.add(mesh);
    return mesh;
  }
  const glowSoft = makeGlowMesh();
  const glowSharp = makeGlowMesh();

  let logosReady = false;
  loadLogoTextures()
    .then(({ sharp, soft }) => {
      glowSharp.material.map = sharp;
      glowSoft.material.map = soft;
      glowSharp.material.needsUpdate = true;
      glowSoft.material.needsUpdate = true;
      logosReady = true;
    })
    .catch(() => {
      // The hand-authored silhouette, so the whale is merely inferred rather
      // than genuinely absent if the real asset can't be fetched.
      const fallback = makeWhaleTexture(sdf);
      glowSharp.material.map = fallback;
      glowSoft.material.map = fallback;
      glowSharp.material.needsUpdate = true;
      glowSoft.material.needsUpdate = true;
      logosReady = true;
    });

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

  // Owned here rather than by its old CSS @keyframes entrance: the hero slot
  // is no longer one static statement shown once at load, it cycles through
  // several of DeepSeek's own lines across the dive (see narrationStateAt),
  // and `.hero` is now `position: fixed` (see styles.css) so it stays in view
  // to recur in, rather than scrolling away with the page. heading/tagline
  // are looked up once and their text swapped in the tick loop, rather than
  // re-querying the DOM every frame.
  const heroEl = document.querySelector<HTMLElement>(".hero");
  const heroHeadingEl = heroEl?.querySelector<HTMLElement>("h1") ?? null;
  const heroTaglineEl = heroEl?.querySelector<HTMLElement>(".tagline") ?? null;
  let activeNarrationIndex = -1;

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

    if (heroEl) {
      const narration = narrationStateAt(p);
      if (narration.activeIndex !== activeNarrationIndex) {
        activeNarrationIndex = narration.activeIndex;
        if (activeNarrationIndex !== -1) {
          const line = NARRATION_LINES[activeNarrationIndex]!;
          if (heroHeadingEl) heroHeadingEl.textContent = line.heading;
          if (heroTaglineEl) heroTaglineEl.textContent = line.body;
        }
      }
      heroEl.style.opacity = String(narration.opacity);
      heroEl.style.transform = `scale(${narration.scale})`;
      heroEl.style.filter = narration.blurPx > 0.05 ? `blur(${narration.blurPx}px)` : "none";
    }

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
    glowSoft.position.set(0, 0, camera.position.z - whaleDistance);
    glowSharp.position.copy(glowSoft.position);
    if (logosReady) {
      const resolve = logoResolveAmount(p);
      // The soft layer eases back as the sharp mark takes over, rather than
      // both sitting at full additive strength together and blowing out —
      // the mark should emerge from the light, not just sit on top of it.
      glowSoft.material.opacity = THREE.MathUtils.lerp(GLOW_OPACITY_SURFACE, GLOW_OPACITY_EYE, p) * (1 - 0.3 * resolve);
      glowSharp.material.opacity = resolve * LOGO_SHARP_MAX_OPACITY;
    }

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
