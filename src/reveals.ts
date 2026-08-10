import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// The hero's own entrance (headline + tagline) is a plain CSS @keyframes
// animation in styles.css, not GSAP — it has to play the instant the page
// paints, with zero dependency on this script even having run yet.

// Real content visible post-eye (product cards, the footer) surfaces the
// same way the flow field's own text and the hero do: growing from small and
// faint to full size and opacity, in place — no sliding, just emerging.
// .paper-card is deliberately excluded — it's visually hidden (see
// styles.css) so it never appears on screen at all, pre- or post-reveal.
export function setupScrollReveals(): void {
  const targets = document.querySelectorAll<HTMLElement>(".surface-card, .surface-lede, .legal");

  targets.forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, scale: 0.15 },
      {
        opacity: 1,
        scale: 1,
        duration: 1.3,
        ease: "power2.out",
        scrollTrigger: {
          trigger: el,
          start: "top 88%",
          toggleActions: "play none none none",
        },
      },
    );
  });
}
