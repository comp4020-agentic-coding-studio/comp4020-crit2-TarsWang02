# Process overview

## What I built

A redesign of deepseek.com as a descent. You scroll down through a volume of
DeepSeek's own published research — real paper titles and my own factual
rewrites of what each one did — and the text current bends around a whale that
is never drawn. Its presence is only ever inferred from the hole it leaves.

## The moments that mattered

**The whale wasn't there, and I couldn't tell.** Three rounds of moving
constants had produced a scene I could squint at and believe in. The real fault
was structural: the exclusion was gated to a slab of depth around a fixed world
`z` while the strand band was camera-relative, so most of the field never saw
the whale. I put both in one frame and made the exclusion a **cone from the
camera** rather than a tube — a tube projects to a different screen region at
each depth, so the edge smears; a cone projects to one, so every layer
reinforces the same outline.

What settled it was building sensors instead of trusting my eyes.
`spec/whale.test.ts` asserts the footprint is depth-independent and that
repulsion is non-zero at every depth; it fails against the old gated version.
That proves the geometry is coherent, not that anything is *visible*, so
`scripts/probe-whale.js` reads the canvas back and compares pixel density
inside the whale's projected footprint against open water at the same distance
from centre. Inside came back ~3× emptier at three points of the dive
(0.29 / 0.35 / 0.29). Before that number existed, "is there a whale" was an
opinion
([`4922e25`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit2-TarsWang02/commit/4922e25)).

**The site was perfect on my machine and blank on his.** The report was that
nothing rendered at all — no text, no whale. My screenshots showed a full
field. Both were true, and the disagreement was the evidence: troika 0.52.5
defaults its font to `null`, hands the worker an empty font list, and quietly
falls back to fetching glyphs from `cdn.jsdelivr.net` at runtime. That fetch
failing throws nothing — every mesh syncs "successfully" with no geometry. I
could reach jsdelivr; he couldn't. A site about a Chinese AI lab had a hidden
runtime dependency on a CDN that is unreliable from China.

The instrumentation is what closed it: counting meshes whose geometry actually
had vertices (`446/446` after the fix) instead of pixel-probing the canvas
again. My first attempt at that count used troika's `sync()` callback and
never fired at all, because those meshes were already synced — silence I'd
have misread as proof of a dead field if I hadn't checked why
([`a2ed248`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit2-TarsWang02/commit/a2ed248)).
