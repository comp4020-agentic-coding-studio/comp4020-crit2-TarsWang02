# Process overview

## What I built

A redesign of deepseek.com as a descent. You scroll down through a volume of
DeepSeek's own published research — real paper titles and my own factual
rewrites of what each one did — and the text current bends around a whale that
is never drawn. Its presence is only ever inferred from the hole it leaves.

## The moments that mattered

**The whale wasn't there, and I couldn't tell.** Three rounds of moving
constants had produced a scene I could squint at and believe in. The real
fault was structural: the exclusion was gated to a slab of depth around a
fixed world `z` while the strand band was camera-relative, so most of the
field never saw the whale. Putting both in one frame and making the exclusion
a **cone from the camera** rather than a tube fixed it — a tube projects to a
different screen region at each depth, so the edge smears; a cone projects to
one. What settled it was building sensors instead of trusting my eyes:
`spec/whale.test.ts` asserts the footprint is depth-independent, and
`scripts/probe-whale.js` reads the canvas back and compares pixel density
inside the whale's footprint against open water. Before that number existed,
"is there a whale" was an opinion
([`4922e25`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit2-TarsWang02/commit/4922e25)).

**The site was perfect on my machine and blank on his.** The report was that
nothing rendered. My screenshots showed a full field. Both were true, and the
disagreement *was* the evidence: troika defaults its font to `null` and
quietly falls back to fetching glyphs from `cdn.jsdelivr.net` at runtime. That
fetch failing throws nothing — every mesh syncs "successfully" with no
geometry. I could reach jsdelivr; he couldn't. A site about a Chinese AI lab
had a hidden runtime dependency on a CDN unreliable from China. Counting
meshes with real vertices (`446/446` after the fix) is what closed it
([`a2ed248`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit2-TarsWang02/commit/a2ed248)).
