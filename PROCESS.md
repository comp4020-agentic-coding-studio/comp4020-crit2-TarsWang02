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

**A stated cause I didn't accept.** A whole-scene blackout came to me
diagnosed as a camera-vs-lifecycle geometry conflict. The geometry was wrong,
but fixing it didn't clear the blackout: `clock.elapsedTime` jumps by the full
pause when a backgrounded tab resumes, ageing every strand past its lifespan in
one frame. Clamped `dt` accumulation fixed it
([`71d0423...4922e25`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit2-TarsWang02/compare/71d0423...4922e25)).
