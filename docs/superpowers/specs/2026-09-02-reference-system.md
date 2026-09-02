# The reference system, read as rules

Date: 2026-09-02
Source: the reference set supplied by the user (see `../references/`).

This is not a mood board. It is the **design-intelligence document** the
architecture calls for in Layer 4 — the rules the agent queries rather than is
told, written against real artwork instead of general design theory.

The important discovery on reading the set properly: it is not twelve unrelated
posters. Slides 2–7 are **one template**, run six times with different content.
A template is extractable. That is what makes 90–95% first-shot plausible at
all — the agent is not inventing a composition, it is filling a system.

---

## System A — the font-showcase carousel

Six slides, one skeleton. The most valuable reference in the set, because the
repetition proves which parts are rules and which are content.

**Canvas.** 4:5 portrait, 1080×1350.

**Ground.** Mottled light plaster-paper, roughly `#E4E3E1` drifting to
`#D2D1CF`, with a visible halftone dot screen over the entire canvas and a
soft corner vignette. The texture is **global** — it sits over ground, subject
and type alike. It is not a per-element effect, and this is the single
strongest correction to our earlier recreation, where texture was applied
per-layer at low opacity and read as nothing.

**Colour, three roles and no more.**

| Role | Value | Used for |
| --- | --- | --- |
| Ground | warm light grey | canvas, texture |
| Ink | near-black | all type, halftone subject |
| Accent | one saturated red | feathers, wings, active page number, a single word |

Photographic subjects are **desaturated to halftone black-and-white, then the
accent hue alone is retained**. The macaw is red and grey; nothing else in the
frame carries colour. This is a rule, not a preference — it is why the set
looks authored rather than assembled.

**Type: exactly two faces.**

- A **condensed grotesque display** carrying the hero word — `MILLENIUM`,
  `Stretchio`, `GILL SANS`, `Jakarta SANS`. Very heavy, very tight, occupying
  70–85% of canvas width. This is the loudest element on the page.
- A **script serif with swash alternates** for the qualifier line directly
  above it — *Clean + Unique*, *Clean + Expressive*, *Friendly + Flexible*.
  Set small, roughly one-fifth the hero's size. The swash sweeps off the
  initial letter.

The pairing is the whole identity: one face shouts, one face signs.

**Micro-type as structure.** Three separate places use ~9px uppercase with
heavy letter-spacing:

- a three-column header — left `HOWCOULDIKNOWBRO`, centre `THIS DESIGN
  CONTAINS`, right `SEXY AF FONTS`
- a 3–4 line body paragraph, condensed caps, left-aligned, sitting low
- a footer: `SAVE FOR FUTURE PROJECTS` left, and `01 02 03 04 05 06 07` right
  with the current slide in the accent red

Tiny tracked-out type is doing structural work here, not decoration. It frames
the canvas and tells the reader where they are in the sequence.

**Bleed.** Feathers, wings and branches run off the canvas edge in every
slide. Nothing decorative is fully contained. A composition where every
element sits politely inside the frame will read as ours, not as theirs.

**Depth.** The subject overlaps the hero word — in front of some letters,
behind others. Drop shadows sit under the floating accent objects.

---

## System B — the productivity carousel

Five slides, looser, and useful precisely because it breaks System A's rules
in a controlled way.

- Ground colour **changes per slide** — sky blue, cream, near-white, saturated
  orange — while type and grain stay constant. So the theme token is the
  ground, and swapping it is a one-value edit. This is the clearest argument in
  the whole set for tokenised colour roles.
- Same two-face structure: condensed display plus a script italic serif
  (*More creativity.*).
- Connective text is tracked-out lowercase rather than caps — a softer register
  from the same mechanism.
- A pixel-art cursor appears as a deliberate anachronism. Worth noting as a
  category: **one intentional wrong-era element** is a repeated move in
  contemporary poster work.

---

## The subject-behind-type poster

The orange poster is the clearest statement of the effect that matters most.

A figure walks through the word `skills`. The head and torso sit **in front of**
the letterforms; the legs pass **behind** them. So this is not one z-order — the
type is drawn, the subject's mask is applied to a second copy, and the two
interleave.

This is exactly the effect our recreation failed at, and it needs three things
we do not yet have: a real alpha mask, the ability to render the same string
twice, and per-element style control to mask the second copy. It is a good
acceptance test for the whole stack — if this poster is reproducible, the
architecture works.

---

## Rules, in the form the agent will read them

**ALWAYS**

- Three colours with fixed roles: ground, ink, one accent. The accent appears
  in at most three places.
- Two faces: one condensed display for the hero, one script serif for the
  qualifier.
- The hero word spans 70–85% of canvas width.
- Texture is global — one screen over the finished composition.
- Photographic subjects are monochrome except the accent hue.
- At least one element bleeds off the canvas edge.
- Micro-type frames the canvas: header row, body block, footer index.

**NEVER**

- A third typeface.
- A second saturated hue.
- Texture applied per-element at low opacity — it disappears and reads as
  nothing. Our recreation used `opacity: 0.14` and the halftone was invisible.
- `transform: scaleX()` to fake a condensed face. It distorts stroke weights.
  Use a genuinely condensed face.
- Every element contained inside the frame.
- A subject sitting flatly in front of or behind the type when it should
  interleave.

---

## What this changes about the build

The template is the highest-leverage artifact in this set, and it argues for
one reordering: **the design-intelligence document is worth more, earlier, than
the effects vocabulary**. Effects without rules produce our recreation — every
individual effect present, the whole thing generic. Rules without effects at
least produce a correct composition in flat colour.

Nothing here is blocked on the remaining unknowns. The rules above are
readable, checkable, and can be encoded before a single shader exists.
