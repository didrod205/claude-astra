# Reading the writing

The extractor gives you the visual system. This is the other half, and it does
not come out of a parser — you get it by reading two of the samples properly.

## What to look for

Take one representative sample and answer these. Ten minutes, and it changes the
output more than any colour value.

**Sentence shape.** Average length. Do they run compound sentences or short
declaratives? Are bullets fragments or full sentences — and are they punctuated?

**Person and stance.** "We recommend", "It is recommended", "You should", or no
agent at all. Whether the author appears.

**How a section opens.** Claim first then support, or context first then claim?
This is the most transferable structural habit in any house style.

**Titles.** Labels ("Q3 Revenue") or assertions ("Q3 revenue fell on
enterprise churn")? Assertive slide titles are a strong house signal and easy to
get wrong in both directions.

**Numbers.** Rounded to what? In the sentence, a table, or a chart? Is a number
ever given without a comparison?

**Hedging.** "may indicate" / "suggests" / "shows" / "proves". Match it. Writing
more confidently than the house does reads as someone else wrote it, and so does
writing less confidently.

**Density.** Words per slide, per page. Count them on two samples rather than
guessing — this is where generated documents drift most.

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
2. **Match density on purpose.** If their slides hold 30 words, write 30. This is
   the constraint most likely to be quietly ignored.
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
- [ ] density compared against a real sample, not estimated
- [ ] every number traceable to a source the user gave you
- [ ] said plainly what you invented because the samples did not cover it

That last one matters most. The user knows their own style better than the
extractor does; telling them exactly where you had to guess is what lets them fix
it in one pass instead of three.
