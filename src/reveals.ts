import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// The hero slot's own opacity/scale/blur is owned entirely by scene.ts's
// tick loop (see narrationStateAt there), not by this module — it's a direct
// function of dive progress, same as everything else in the WebGL scene.

// Real content visible post-eye (product cards, the footer) surfaces the
// same way the flow field's own text and the hero do: growing from small and
// faint to full size and opacity, in place — no sliding, just emerging.
// .paper-card is deliberately excluded — it's visually hidden (see
// styles.css) so it never appears on screen at all, pre- or post-reveal.
//
// scrub, not a fixed-duration play-once tween: every other motion on this
// site — the camera, the fog, the iris, the hero, every strand — is a direct
// function of scroll position, never of wall-clock time (see scene.ts's own
// extended argument for this). A timed tween here was the one place that
// contract didn't hold, and it sat right at the surface transition: scroll
// past its trigger at a different speed than the tween's own 1.3s and cards
// either lag behind a scroll that's already moved on or sit queued mid-fade,
// which reads as a disconnected "pop" rather than part of the same
// continuous motion the whole dive just was. Scrubbing it ties the reveal to
// scroll directly, and — like every scrubbed motion elsewhere here — makes
// it reversible: scroll back up and a card recedes the same way it arrived.
export function setupScrollReveals(): void {
  const targets = document.querySelectorAll<HTMLElement>(".surface-card, .surface-lede, .legal");

  targets.forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, scale: 0.15 },
      {
        opacity: 1,
        scale: 1,
        ease: "power2.out",
        scrollTrigger: {
          trigger: el,
          start: "top 95%",
          end: "top 55%",
          scrub: 0.6,
        },
      },
    );
  });
}
