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

export function setupEyeTransition(): void {
  const eye = document.querySelector<HTMLElement>("#eye");
  const iris = document.querySelector<HTMLElement>(".iris");
  const irisGlow = document.querySelector<HTMLElement>(".iris-glow");
  if (!eye || !iris || !irisGlow) return;

  ScrollTrigger.create({
    trigger: eye,
    start: "top top",
    end: () => `+=${eye.offsetHeight - window.innerHeight}`,
    scrub: 0.5,
    onUpdate: (self) => {
      const r = self.progress * 150;
      iris.style.clipPath = `circle(${r}% at 50% 50%)`;
      irisGlow.style.clipPath = `circle(${Math.min(r * GLOW_LEAD, 160)}% at 50% 50%)`;
    },
  });
}
