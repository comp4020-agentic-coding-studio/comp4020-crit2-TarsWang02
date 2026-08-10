# Crit 2 — Unsolicited redesign

## The breakthrough

It was giving up on looking at the thing. The whole concept rests on an absence
— a whale you never see, inferred from text bending around it — and for three
rounds I kept assessing that by opening the page and deciding whether it felt
right. It always sort of did, which is exactly the problem: a field sparse
enough to have no edge looks about the same as a field with a hole in it, and I
had no way to tell those apart.

The turn was writing `scripts/probe-whale.js`, which reads the canvas back and
counts lit pixels inside the whale's projected footprint against open water at
the same distance from centre. The first honest number said inside and outside
were nearly identical — there was no whale, regardless of what the code claimed
to be doing. Everything that actually fixed it (one coordinate frame, a cone
instead of a depth-gated slab, an order of magnitude more text) followed from
finally having a number that could say no.

## What it changed

I've been treating tests as something you write about logic — pure functions,
edge cases, the parts that are already easy to be sure of. The hard part of
this project was the part I'd have called subjective and left unmeasured. It
turned out to be measurable; I just hadn't tried.

So the developer I want to be is one whose first question about a vague claim
is "what would tell me this is false?" rather than "does this look okay?" I
also want to stop accepting stated causes. The blackout came with a confident
diagnosis attached. It was wrong, and I'd have shipped a plausible fix to the
wrong thing if I hadn't checked.
