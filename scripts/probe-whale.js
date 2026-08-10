// Pixel probe: does the rendered canvas actually contain a whale-shaped hole?
//
// Reading the diff cannot answer that. Neither can the geometry tests in
// spec/whale.test.ts — those prove the exclusion is a coherent cone, which is
// necessary but not sufficient: a field too sparse to have an edge satisfies
// every one of them and still shows no whale.
//
// So this measures the thing the concept actually promises. It samples two
// regions of the real canvas at the same distance from centre — one inside
// the whale's projected footprint, one beside it in open water — and compares
// how many pixels are brighter than the background. A whale means
// meaningfully fewer inside than outside. If inside ≈ outside there is no
// whale, whatever the code says it is doing.
//
// Usage: `pnpm dev`, open the site, paste this file into the devtools
// console, then `await probeWhale()` — or `await probeWhaleAcrossDive()` to
// walk the whole descent. Kept as a script rather than wired into `pnpm
// check` because it needs a real GPU and a real canvas; CI holds the line on
// the geometry instead.

/** Counts pixels brighter than the background inside a rectangle of the canvas. */
function countBright(pixels, canvasWidth, rect, backgroundSum, threshold = 18) {
  let bright = 0;
  let total = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * canvasWidth + x) * 4;
      const sum = pixels[i] + pixels[i + 1] + pixels[i + 2];
      total++;
      if (sum > backgroundSum + threshold) bright++;
    }
  }
  return { bright, total, pct: total ? (100 * bright) / total : 0 };
}

/**
 * Samples the canvas inside and outside the whale's footprint.
 *
 * The whale is a wide, shallow shape centred in the view, so "inside" is a
 * band across the middle and "outside" is the matching band above it —
 * equally far from centre horizontally, so perspective and fog affect both
 * about the same and the difference is attributable to the whale.
 */
async function probeWhale() {
  const canvas = document.querySelector("#flow-field");
  if (!canvas) throw new Error("no #flow-field canvas");

  const readback = document.createElement("canvas");
  readback.width = canvas.width;
  readback.height = canvas.height;
  const ctx = readback.getContext("2d");
  ctx.drawImage(canvas, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  // Background is whatever the corner is — the fog colour at this point of
  // the dive, which darkens as you descend, so it must be read not assumed.
  const cornerIndex = (4 * canvas.width + 4) * 4;
  const backgroundSum = pixels[cornerIndex] + pixels[cornerIndex + 1] + pixels[cornerIndex + 2];

  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(canvas.height / 2);
  const bandW = Math.floor(canvas.width * 0.34);
  const bandH = Math.floor(canvas.height * 0.13);

  const inside = countBright(
    pixels,
    canvas.width,
    { x: cx - Math.floor(bandW / 2), y: cy - Math.floor(bandH / 2), w: bandW, h: bandH },
    backgroundSum,
  );
  const outside = countBright(
    pixels,
    canvas.width,
    { x: cx - Math.floor(bandW / 2), y: Math.floor(canvas.height * 0.12), w: bandW, h: bandH },
    backgroundSum,
  );

  const ratio = outside.pct === 0 ? 0 : inside.pct / outside.pct;
  return {
    scrollY: window.scrollY,
    backgroundSum,
    insidePct: +inside.pct.toFixed(3),
    outsidePct: +outside.pct.toFixed(3),
    ratio: +ratio.toFixed(3),
    // Anything rendering at all — guards against the whole-scene blackout
    // this project has hit before, where inside and outside were both zero
    // and the ratio looked "fine".
    anythingRendered: inside.bright + outside.bright > 0,
    reads: ratio < 0.6 && outside.pct > 0.4,
  };
}

/** Walks the dive and probes at each point. */
async function probeWhaleAcrossDive(samples = 5) {
  const depth = document.querySelector("#depth");
  const eye = document.querySelector("#eye");
  const start = depth.offsetTop;
  const end = eye.offsetTop + eye.offsetHeight - window.innerHeight;
  const results = [];
  for (let i = 0; i < samples; i++) {
    window.scrollTo(0, start + ((end - start) * i) / (samples - 1));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    results.push(await probeWhale());
  }
  console.table(results);
  return results;
}

globalThis.probeWhale = probeWhale;
globalThis.probeWhaleAcrossDive = probeWhaleAcrossDive;
