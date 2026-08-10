import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// The only transition in the site: an iris-shaped clip-path closing over the
// view as you scroll through #eye, then releasing into #surface once you've
// scrolled past it. A simplified stand-in for a true WebGL stencil portal —
// the honest fallback the brief allows when time is short (see CLAUDE.md's
// C2 concept, "Implementation" section, point 3).
export function setupEyeTransition(): void {
  const eye = document.querySelector<HTMLElement>("#eye");
  const iris = document.querySelector<HTMLElement>(".iris");
  if (!eye || !iris) return;

  ScrollTrigger.create({
    trigger: eye,
    start: "top top",
    end: () => `+=${eye.offsetHeight - window.innerHeight}`,
    scrub: 0.5,
    onUpdate: (self) => {
      iris.style.clipPath = `circle(${self.progress * 150}% at 50% 50%)`;
    },
  });
}
