import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// The only transition in the site: an iris-shaped clip-path closing over the
// view as you scroll through #eye, then releasing into #surface once you've
// scrolled past it. A simplified stand-in for a true WebGL stencil portal —
// the honest fallback the brief allows when time is short (see CLAUDE.md's
// C2 concept, "Implementation" section, point 3).
//
// Two clip-path circles, not one: `.iris` is the solid mask (its own
// background is a radial gradient — see styles.css — so growing it doesn't
// paint a flat black disc, it sweeps outward through a bright core the way
// an actual iris does before reaching black); `.iris-glow` is a blurred,
// brighter copy of the same gradient, grown to a slightly larger radius so
// its glow always leads a step ahead of the solid mask's edge. The result is
// light expanding and then being overtaken by the mask behind it, rather
// than one flat colour wiping across the screen.
const GLOW_LEAD = 1.15; // the glow layer's radius as a multiple of the solid mask's

/**
 * `.iris-stack` is `position: fixed`, not `sticky` — deliberately, after a
 * `sticky` version shipped a dead zone that read as "the mask finishes and
 * then you're still stuck scrolling through black before #surface shows up".
 * That gap isn't a tuning mistake, it's an inherent property of
 * `position: sticky; top: 0`: a sticky element can only stay pinned until
 * its container has exactly one more viewport-height of room left, so it
 * releases a full 100vh *before* the container (#eye) actually ends. A fixed
 * overlay has no such reservation.
 *
 * Visibility is the clip-path itself, not a separate `display` toggle — an
 * earlier version toggled `display: none/block` via a second ScrollTrigger's
 * onEnter/onLeave, which forces a layout reflow on every crossing and read
 * as choppy rather than smooth. `circle(0%)` is already a zero-area shape,
 * i.e. already fully invisible, so there is nothing a `display` toggle adds
 * for the "before #eye" and "after #eye" cases except that extra reflow —
 * `self.progress` is naturally 0 (so r is 0, invisible) for the whole
 * approach to #eye already. The one place this genuinely needs help is
 * *after* #eye: GSAP clamps a scrubbed trigger's progress at 1 once you
 * scroll past `end`, which would otherwise leave the mask parked at 150%
 * (fully opaque) for the rest of the page — onLeave/onEnterBack below
 * override the clip-path directly for exactly that case, nothing else.
 * `.iris-stack` itself stays permanently `pointer-events: none` (see
 * styles.css) so an always-present, usually-invisible full-viewport fixed
 * box can never swallow a click on real content underneath it.
 *
 * Only `onLeave` needs a manual override, not all four edges: `onEnter` and
 * `onLeaveBack` both land at progress ≈ 0, where r is already 0 (invisible)
 * from the ordinary progress → r mapping, and `onEnterBack` lands back at
 * progress ≈ 1, which the very next onUpdate recomputes correctly on its
 * own. Only scrolling *past* `end` clamps progress at 1 instead of letting
 * it fall back to 0, which is the one case that actually needs correcting.
 */
export function setupEyeTransition(): void {
  const eye = document.querySelector<HTMLElement>("#eye");
  const iris = document.querySelector<HTMLElement>(".iris");
  const irisGlow = document.querySelector<HTMLElement>(".iris-glow");
  if (!eye || !iris || !irisGlow) return;

  const setClip = (r: number): void => {
    iris.style.clipPath = `circle(${r}% at 50% 50%)`;
    irisGlow.style.clipPath = `circle(${Math.min(r * GLOW_LEAD, 160)}% at 50% 50%)`;
  };

  // The clip animation spans the whole of #eye's own height, not
  // `offsetHeight - innerHeight` — that subtraction existed only to leave
  // room for a sticky element's own height, which a fixed overlay doesn't
  // need. Reaching 100% now coincides with #eye's bottom edge exactly.
  ScrollTrigger.create({
    trigger: eye,
    start: "top top",
    end: "bottom top",
    scrub: 0.5,
    onUpdate: (self) => setClip(self.progress * 150),
    onLeave: () => setClip(0),
  });
}
