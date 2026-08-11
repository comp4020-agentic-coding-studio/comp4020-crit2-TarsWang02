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
 * releases a full 100vh *before* the container (#eye) actually ends —
 * whatever #eye's total height is, there is always a trailing 100vh where
 * the mask sits fully closed with nothing happening, because the sticky
 * element has already un-pinned and is just scrolling through its own
 * reserved space. No amount of retuning #eye's height removes that; only
 * not depending on sticky's release timing does.
 *
 * A fixed overlay has no such reservation. Its visibility is driven
 * explicitly by a second ScrollTrigger's onEnter/onLeave callbacks, so it
 * appears exactly when #eye starts and disappears exactly when #eye ends —
 * the same instant #surface begins, not a screen-height later.
 */
export function setupEyeTransition(): void {
  const eye = document.querySelector<HTMLElement>("#eye");
  const stack = document.querySelector<HTMLElement>(".iris-stack");
  const iris = document.querySelector<HTMLElement>(".iris");
  const irisGlow = document.querySelector<HTMLElement>(".iris-glow");
  if (!eye || !stack || !iris || !irisGlow) return;

  const setVisible = (visible: boolean): void => {
    stack.style.display = visible ? "block" : "none";
  };
  setVisible(false);

  ScrollTrigger.create({
    trigger: eye,
    start: "top top",
    end: "bottom top",
    onEnter: () => setVisible(true),
    onEnterBack: () => setVisible(true),
    onLeave: () => setVisible(false),
    onLeaveBack: () => setVisible(false),
  });

  // The clip animation now spans the whole of #eye's own height, not
  // `offsetHeight - innerHeight` — that subtraction existed only to leave
  // room for the sticky element's own height, which a fixed overlay doesn't
  // need. Reaching 100% now coincides with #eye's bottom edge exactly.
  ScrollTrigger.create({
    trigger: eye,
    start: "top top",
    end: "bottom top",
    scrub: 0.5,
    onUpdate: (self) => {
      const r = self.progress * 150;
      iris.style.clipPath = `circle(${r}% at 50% 50%)`;
      irisGlow.style.clipPath = `circle(${Math.min(r * GLOW_LEAD, 160)}% at 50% 50%)`;
    },
  });
}
