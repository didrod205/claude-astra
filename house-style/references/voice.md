# Reading the writing

The extractor gives you the visual system. This is the other half — and rather
more of it comes out of a parser than people assume.

## What is measured for you

`style.py extract` reports a `prose` block per unit kind (slide or page), and
`check` compares a finished file against it:

```
prose  9 words/slide · sentence 3 w (p90 3) · 3.0 bullets/slide
       · 0% end in a full stop · headings 1 w
```

| measured | flagged when |
|---|---|
| **density** — words per slide or page | more than 2x, or less than half, the house average |
| **sentence length** — median words, within a block | longer than 1.6x *and* six words above the house median |
| **punctuation convention** — do blocks end in terminal punctuation | the house writes fragments and you wrote sentences, or the reverse |
| **person** — first and second person per 1000 words | the samples barely use it and you used it freely |
| **exclamations** | the samples use none and you used some |
| **title style** — median words in a heading | the samples label in one or two words and yours assert in ten |

That last pair is the one worth dwelling on. A deck whose slide titles read
*"Q3 Revenue"* and a deck whose titles read *"We are delighted to report that
third quarter revenue grew substantially"* are not the same house, and the
difference is a number.

Density is the constraint most likely to be quietly ignored, which is exactly
why it is checked rather than described.

## What still needs you to read the samples

The numbers say how much and how long. They do not say what kind.

## What to look for

Take one representative sample and answer these. Ten minutes, and it changes the
output more than any colour value.


**Person and stance.** "We recommend", "It is recommended", "You should", or no
agent at all. Whether the author appears.

**How a section opens.** Claim first then support, or context first then claim?
This is the most transferable structural habit in any house style.

**Titles.** Labels or assertions? The word count tells you which; only reading
tells you what a good one of theirs actually says.

**Numbers.** Rounded to what? In the sentence, a table, or a chart? Is a number
ever given without a comparison?

**Hedging.** "may indicate" / "suggests" / "shows" / "proves". Match it. Writing
more confidently than the house does reads as someone else wrote it, and so does
writing less confidently.


**Furniture.** Does every deck open with an agenda and close with next steps? Is
there a standing summary? Do sections have dividers? Does every page carry a
footer, and what is in it?

**What they never do.** Usually the sharpest signal, and only visible by reading:
no exclamation marks, never more than five bullets, no slide without a takeaway,
no first person, no stock photography, no acronym unexpanded on first use.

Write the answers down next to `style.json`. Keeping them in the same folder as
the spec is what makes the next document cheap.

## Turning it into the draft

1. **Structure first, in their vocabulary.** For a deck, list the slides by
   layout name from the extracted layout list before writing a word.
2. **Match density on purpose.** The spec gives you the number. Write to it.
3. **Reuse their file as the template** where the format allows it. Starting from
   their document and replacing content preserves everything nobody measured.
4. **Titles in their form.** If titles are assertions, every title is an
   assertion — including the boring ones.
5. **Leave a gap rather than invent.** If the samples never show a chart style and
   your content wants a chart, pick something neutral, and say so in the handover.

## Before handing over

- [ ] `style.py check` run, and every error resolved
- [ ] warnings each either fixed or explained in the handover
- [ ] rendered and looked at — the check cannot see a title overflowing its box,
      two elements colliding, or an unbalanced slide
- [ ] density, sentence length and title length inside the spec's numbers
- [ ] every number traceable to a source the user gave you
- [ ] said plainly what you invented because the samples did not cover it

That last one matters most. The user knows their own style better than the
extractor does; telling them exactly where you had to guess is what lets them fix
it in one pass instead of three.
