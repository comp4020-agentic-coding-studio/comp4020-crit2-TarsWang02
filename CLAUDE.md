# COMP4020 prototype

This is your starter repo for a COMP4020 prototype: a static site written in
HTML/CSS/TypeScript that builds to plain HTML/CSS/JS and deploys to GitHub
Pages. The **deployed site is what gets marked** --- not this repo, and not "it
works on my machine". It's marked live in Chrome against the deployed URL at two
viewports --- 1920×1080 (desktop) and 390×844 (phone) --- and both count in
full, so make that artefact good at both and use the checks below to know
whether it is.

What you're building this week — the spec — is published on the course website,
and this repo's name tells you which deliverable it is. Run the course plugin's
**start** skill at the start of each week: it pulls the right spec from the
course API, carries your harness forward from last week, and helps you turn the
spec's checkable lines into tests of your own. Read the spec before you build,
and see `spec/README.md` for how the checks in this repo relate to it.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Before you push, run `pnpm check`. It runs most of what CI runs --- build,
  lint, and the spec --- so you catch those in seconds instead of waiting for
  the pipeline. The links check, the evidence check, the secrets scan, and the
  deploy itself only run in CI; run `pnpm dlx linkinator ./dist --silent`
  locally against a fresh `pnpm build` for the links check without waiting for
  CI.
- To see what the page actually looks like rather than what you assume it looks
  like, open it in a browser (the `agent-browser` CLI, documented on
  [the course site](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/backpressure/#agent-browser-the-rendered-page-as-ground-truth),
  works well for this). The rendered page is the truth; your mental model of it
  isn't.
- When a check fails, read its output before changing anything. Each check below
  names what it measures, and the failure message is the instruction: it tells
  you the file, the line, or the contract. Treat a red check as authoritative
  --- the page is wrong until the check is green, not until you decide it should
  be.
- Commit when the checks pass. Never commit a red state.

## The checks (your sensors)

CI runs these on every push once your repo is public. GitHub's checks UI shows
two jobs, `check` and `deploy` --- not one status per sensor below --- and
within `check` the steps run in sequence (`pnpm check` chains typecheck, build,
lint, and the spec with `&&`), so an early failure like a broken build stops the
later sensors from running for that push; fix it and push again to see the rest.
While the repo is private (all week, until you ship) the CI jobs stay skipped
--- `pnpm check` is the same roster on your machine, and it's the faster loop
anyway. They aren't hoops. Each is a different way of finding out something true
about the site that you can't reliably see by looking at it.

They also carry a mark at a crit: the sweep runs fifteen minutes after your
cutoff, and green checks there are worth half that week's shipped mark. Still
running counts as not green, so ship with time for CI to finish.

- **typecheck** --- `tsc --noEmit` runs first in `pnpm check`, so a type error
  stops the roster before the build even starts. The types are extra
  backpressure: a red here is the compiler telling you a claim in the code is
  false.
- **build** --- the site must build (`pnpm build`). A build failure means the
  deployed site is broken or stale, so nothing else matters until this is green.
- **deploy / online** --- the live GitHub Pages URL must load and return the
  page you expect. An asset that 404s on the deployed URL counts as broken even
  if it loads locally.
- **spec** --- `spec/invariants.test.ts` asserts what's true of any good
  website, whatever the week's brief asks; the tests you write for the week's
  own spec run alongside it (any `spec/*.test.ts`). A failure names the contract
  you haven't met yet.
- **lint** --- `stylelint` for CSS, `oxlint` for TypeScript. Flags code that's
  wrong, fragile, or non-idiomatic. Read the rule it names.
- **tests** --- any other tests you write, wherever you put them (co-located
  with your source is fine, not just `spec/`), must pass. Vitest picks up both
  this and the spec suite in one `vitest run`, the last step of `pnpm check`. A
  failing test is a claim about the site that's no longer true.
- **evidence** (`pnpm check:evidence`) --- checks your process evidence:
  `PROCESS.md`'s citations resolve to real commits, the current deliverable's
  exact reflection is in `reflections/` (worked out from this repo's name
  against the public course API), and your `CLAUDE.md` is present. Evidence
  gates the deploy --- `deploy` needs `check` to pass, so failing evidence
  blocks the deploy alongside everything else. See
  [Your process is part of the mark](#your-process-is-part-of-the-mark) below,
  and the course website's
  [assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
  for what counts as evidence.
- **links** --- internal links must resolve. A broken link is a dead end you
  didn't mean to ship.
- **secrets** --- the repo is scanned for committed credentials. Never put a
  key, token, or password in a tracked file. If one leaks, rotate it. A local
  pre-commit hook (`.githooks/pre-commit`, installed by `pnpm install`) also
  blocks any commit containing something shaped like an API key --- by the time
  CI sees a key it's already pushed, so the hook is the sensor that matters.

Nothing here measures **accessibility** or **performance** --- wiring those
sensors (`axe-core`, Lighthouse, or whatever you choose) is your work, and later
in the course the spec will ask you to show how you tested both. When you do,
read a green performance result honestly: it's a lab estimate from one run on a
CI machine, not proof the site is fast for real users.

## The stack is swappable

Out of the box this is plain HTML/CSS/TypeScript on Vite, and every `.html` file
in the repo is a page: add pages, link them, and the build picks them up with no
config. That's a default, not a rule (unless the week's spec says otherwise).
You can swap in Astro or any other static generator, because nothing in CI names
a tool --- the whole contract is:

- `pnpm build` emits the complete site into `dist/`
- the `package.json` scripts (`check`, `check:evidence`, `build`) keep working
- whatever lands in `dist/` still passes the invariants in `spec/`

Two things bite in a swap. The deployed site lives under a path
(`…github.io/<repo>/`), so configure your generator's base path --- this
template's Vite config uses relative asset URLs to sidestep that, but most
generators (Astro included) need `base` set explicitly, and getting it wrong
looks fine locally while every asset 404s on the live URL. And commit the
updated `pnpm-lock.yaml`: CI installs with `--frozen-lockfile`.

## Your process is part of the mark

The deployed page is only half of it. How you got there is marked too: your
commit history, your agent files, and the decisions visible across them. The
checks above can't see any of that, so a person reads it directly --- which
means building legibly is part of building well.

- **Commit as you go.** Small, frequent commits are the record of how the work
  came together, and that record is read, not just the final state. A trail that
  grew alongside the code is the strongest evidence of your process; a single
  dump the night before is the weakest.
- **Keep a process overview** (`PROCESS.md`). A short reading-guide, not an
  essay: what you built, the moments that mattered --- each pointing at a
  commit, a `CLAUDE.md` change, or a prompt and the commit it produced --- and
  where to look in the history. It points a marker at the evidence; it doesn't
  stand in for it, and claims the history doesn't back don't count. The
  `PROCESS.md` in this repo is a template showing the shape and the citation
  format (link text the commit hash or range, target the commit or compare URL);
  `pnpm check:evidence` verifies your citations resolve to real commits before
  you ship. Markers follow those citations and don't trawl the repo for evidence
  you didn't cite.
- **Write your reflection in `reflections/`** --- a short markdown file in this
  repo, named for the deliverable it answers, so the number in the filename is
  the number in this repo's name (`crit-1.md` in `comp4020-crit1-<you>`,
  `assignment-1.md` in `comp4020-ass1-<you>`); `reflections/README.md` has the
  full rule. `pnpm check:evidence` checks the exact current name against the
  course API, not merely the presence of any well-named file. It answers the two
  standing prompts: the breakthrough that moved the work forward, and what this
  work changed about the developer you want to be. It stays out of the deployed
  site. It's due at the cutoff, and if it isn't in the repo by then the week
  doesn't count as shipped, however good the prototype is.
- **This file is process evidence.** The harness you build to direct the agent,
  this `CLAUDE.md` and any `AGENTS.md`, is itself read as part of how you
  worked. Keep it honest and current (see below).

You don't need a name, a student number, or any identity file in the repo: we
know whose repo it is. Spend the effort on the work.

## This file is yours

This CLAUDE.md is a starting point, not a fixed rulebook. As you learn what your
prototype needs --- a convention to hold the agent to, a sensor that keeps
catching you out, a fact about the stack the agent keeps getting wrong --- write
it down here. Growing this file is the work of harness engineering, and the gap
between this boilerplate and your own version is part of what your prototype
says about the developer you're becoming.

## C2 concept: DeepSeek, redesigned

Planned before any code was written, across a long design conversation outside
this repo (not a single prompt --- the concept below was argued into shape
through several rounds of reference-checking and refinement). This section is
the brief for whichever session implements it. Read all of it before starting;
the pieces depend on each other.

**The organisation.** DeepSeek (deepseek.com) --- a real, significant
open-source AI lab, genuinely rated: DeepSeek-V4-Flash was this course's own
"what changed this week" story in the week 2 lecture. Liked for what they've
shipped, not for their marketing site.

**Cutoff: Wed 12 Aug, 12:00** (2h before the Yunlin Wed 14:00 session).

**Why this target, specifically (surveyed against the field first, not picked
first):** Anthropic (editorial serif, cream, restrained), OpenAI (black/white,
product-first, minimal), Mistral (bold pixel-art "M", mosaic-tile background),
and Moonshot AI (black void, glowing crescent, glitch wordmark) were all
checked live. All four are already well-executed --- there's no credible "mine
is better" argument against any of them, which the spec requires you to make.
DeepSeek is the outlier: it has a real, specific mark (the whale/dolphin logo)
and a disciplined single blue, but the actual site around them is a generic
SaaS template --- gradient hero cards, no hierarchy, nothing that uses what the
name or the mark already offer. The gap between "has real brand material" and
"site does nothing with it" is the whole brief.

### The concept

DeepSeek's own name (深度求索, "deep exploration/search") and its whale/dolphin
mark already contain an unused idea: **depth**. The current site never touches
it. The redesign is built on taking that literally rather than decoratively.

- **The whale is a shadow, not a drawing.** Nothing renders a whale outline.
  Instead, the flowing text field (see below) is pushed away from a volume it
  never enters --- the whale's presence is inferred entirely from how the
  current bends, thins, and eddies around an absence. This is the Lovecraftian
  register deliberately: awe from never fully resolving the thing, only its
  effect on everything around it.
- **The deep sea is made of real text, not particles.** The flowing medium is
  DeepSeek's own published material --- paper titles and abstracts (DeepSeek-R1,
  V3, Coder V2, VL, V2, Coder, Math, LLM are all real, published works, listed
  on the current site's footer) --- rendered legibly and in motion, not as
  decorative noise. This is not a style choice layered on top of the content
  requirement; it *is* the content requirement. The spec demands real
  information, restructured and rewritten --- here the real information is
  the visual medium itself.
- **Scrolling is descending.** The journey gets darker and denser, the
  whale-absence grows nearer and larger (inferred, per above, never drawn),
  until the visitor passes through its eye.
- **The eye is the only transition in the whole site.** No tonal switch, no
  separate "clean info" mode bolted on afterwards --- legible real content is
  present from the first second, at every depth. What changes at the eye is
  *which* real content surfaces: before it, the material is about depth ---
  research, the papers themselves, what they've built. After it, the material
  is about surface --- product (DeepSeek App, Chat, Platform, API + pricing),
  how to reach them (Join Us / careers), the practical footer material (service
  status, legal). Read as a story, not a mode switch: first *why it's deep*,
  then *what to do with it*.

### Implementation --- ranked, because not all of it will fit by Wednesday

Build in this order and be honest in `PROCESS.md` about how far you actually
got --- a smaller version of the real idea beats a rushed version of all of it.

1. **Core and non-negotiable:** the text-flow field (real paper titles/abstracts
   as the moving medium, genuinely legible) bending around an unrendered
   whale-shaped volume. This is the idea; without it there's no concept, just a
   dark website.
2. **Second:** scroll-driven descent --- the field gets darker, denser, the
   inferred shape grows as you scroll.
3. **Third, and the first thing to simplify under time pressure:** the eye
   transition. If a true mask/stencil portal effect doesn't fit, a simpler
   iris-shaped clip-path reveal that still reads as "passing through" is an
   honest fallback --- say so in `PROCESS.md` rather than hiding the cut corner.

**Technique notes, so the how matches the idea instead of approximating it:**

- The whale-as-absence effect is a **signed distance field (SDF)** problem: a
  precomputed distance-field mask in the shape of a whale, which the text
  field's flow reads to know what to avoid. This is the standard technique for
  "define a presence by what avoids it" --- worth searching for directly
  (SDF text/particle deflection) rather than reinvented from scratch.
- Rendering large amounts of genuinely legible text in a moving WebGL scene is
  a specific, solved problem --- **troika-three-text** (Three.js) exists
  precisely because naive text-in-WebGL doesn't stay readable at speed or
  scale. Don't hand-roll this.
- The flow itself wants **curl noise** for motion that reads as current rather
  than scatter.
- Scroll-driven camera/scene changes: **Three.js + GSAP ScrollTrigger** for
  real 3D camera control (this is what Oryzo AI, a recent Awwwards Site of the
  Day by Lusion, uses for a comparable effect --- worth a look as a reference
  point, not a template). A CSS-only `animation-timeline: scroll()` fallback
  exists but can't drive a 3D scene the way GSAP can --- reach for GSAP first.
- The eye transition is a **mask/clip-path reveal** --- an iris-shaped
  `clip-path` that opens, or a WebGL stencil buffer for the fuller version.

**On `frontend-design` skill:** worth invoking for the execution pass --- it's
built to avoid generic AI-generated visual defaults, which is exactly the
failure mode being designed against here.

### Real content to build from (checked against the live site, not invented)

- **Research** (real, citable): DeepSeek R1, V3, Coder V2, VL, V2, Coder, Math,
  LLM --- all real published models/papers, currently just a flat footer link
  list with no material around them.
- **Product**: DeepSeek App, DeepSeek Chat, DeepSeek Platform, API Pricing,
  Service Status.
- **Reach them**: Join Us / careers page exists on the live site; legal
  material (Privacy Policy, Terms, Report Vulnerabilities, Transparency) is
  real and should be represented, if minimally, post-eye.
- Current tagline worth keeping or answering directly: "探索未至之境" ("into the
  unknown" / "exploring the uncharted") --- it's already reaching for the mood
  this redesign commits to; the current site just never cashes it in visually.

### Constraints from the spec (`crits/02-unsolicited-redesign`)

- **Static, no backend, no logins** --- but unlike C1, **JavaScript is allowed**
  this week (the spec says "static, no backend," not "no JS"); the whole
  concept above depends on that being true. Astro is the course default stack,
  but any static stack you can defend is fine, including a WebGL-heavy one
  with no backend (Oryzo AI ships exactly that way).
- Real content, restructured and rewritten, not pasted wholesale --- satisfied
  structurally by the concept itself here, since the visual medium *is* real
  content, but still cite sources in `PROCESS.md`.
- Bring both sites side by side to the crit; be ready to name specifically what
  DeepSeek's actual brand material is (the mark, the blue, the name's meaning)
  and how the current site fails to use it.
- The invariants (`spec/invariants.test.ts`) still apply underneath all of
  this --- a real `<nav>`, one `<h1>` per page, alt text, a real title. A
  visually ambitious site is not exempt from being a well-formed one; make
  sure the semantic structure is real HTML underneath the WebGL canvas, not
  only readable inside it.
