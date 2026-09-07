---
name: house-style
description: >-
  Produce documents, decks, and spreadsheets that look and read like the user's
  own — by extracting the house style from a few of their existing files and
  checking the output against it, rather than guessing. Use whenever someone
  hands over sample decks, reports, or templates and wants new material "in the
  same style", "matching our template", "우리 톤으로", "이 템플릿 유지해서",
  "기존 자료랑 똑같은 느낌으로"; when a deck, report, memo, proposal, or analysis
  should match an existing house look; or when checking whether a finished file
  actually conforms. Pairs with the docx / pptx / xlsx / pdf skills, which write
  the files — this one decides what they should contain and proves they match.
  NOT for designing a look from scratch with no reference material.
---

# House style

## The division of labour

The `docx`, `pptx`, `xlsx`, and `pdf` skills know how to *write* files. They do
not know what the user's material is supposed to look like. This skill owns that:
pull the style out of their own documents, write to it, then check the result.

Use both. Do not reimplement file writing here.

## Why extract instead of eyeball

Given three sample decks, the tempting move is to look at them and write
something that feels similar. What actually gets noticed is the specifics: the
body face is Söhne and you used Helvetica, the accent is `#1F4A7D` and you used a
different blue, the headings step 24 / 18 / 13 and you invented 22 / 16 / 12, the
deck is 13.333 × 7.5 and yours is 10 × 7.5.

Those are all recoverable from the files, exactly, in one command. An Office file
is a zip of XML; the theme block names the typefaces and the palette outright.

## The loop

```
1. python3 scripts/style.py extract <their files>... -o style.json
2. Read the summary. Fill in what the numbers cannot say (voice, structure).
3. Write the document — via the docx / pptx / xlsx skill, to the spec.
4. python3 scripts/style.py check <your file> --spec style.json
5. Fix what it reports. Repeat.
```

Ask for samples if you were not given any. Two or three real files beat any
amount of description, and "make it match our template" without the template is
the request you should push back on — one question now saves a rewrite later.

## 1. Extract

```bash
python3 scripts/style.py extract deck.pptx report.docx -o style.json
```

Reads `.docx` `.dotx` `.pptx` `.potx` `.xlsx` `.xltx` with the standard library
alone, and `.pdf` through PyMuPDF when it is installed. It reports:

- **fonts** — the theme's major/minor faces plus every typeface actually used
- **palette** — the theme colour scheme plus every literal colour in the content
- **sizes** — the point-size ladder in use
- **geometry** — page or slide dimensions, and margins where they are declared
- **layouts** — slide layout names, which are the deck's actual vocabulary
- **named styles** — Heading 1, Title, and the rest, with their font and size
- **prose** — words per slide or page, sentence length, bullet count, whether
  blocks end in a full stop, how long a heading runs, how much first and second
  person appears

The full JSON keeps a per-sample breakdown; the printed summary is the merged
house style. `references/spec.md` explains each field and where it comes from.

## 2. What the extractor cannot see

It measures the visual system and the *shape* of the writing — density, sentence
length, punctuation convention, how assertive the titles are. What it cannot
measure is what the writing is for. Read one or two samples and note:

- **Sentence length and density.** Terse bullets or full prose paragraphs?
- **Person and tense.** "We recommend" / "It is recommended" / "You should".
- **How a section opens.** A claim first, or context first?
- **Numbers.** In the sentence, in a table, or in a chart? Rounded how far?
- **Hedging.** Do they write "may indicate" or "shows"?
- **Structure.** How many slides to a section, how a deck opens and closes,
  whether there is a standing summary slide.
- **What they never do.** Often the strongest signal — no clip art, no
  exclamation marks, never more than five bullets, no slide without a takeaway
  title.

Write these down alongside `style.json`. They are half the match and they are the
half that gets skipped.

## 3. Write to the spec

Hand the spec to whichever format skill is doing the writing, as constraints:
these fonts, these colours, this size ladder, this page geometry, these layout
names. Reuse the sample file as the starting template when the format allows it —
starting from their file and replacing content preserves everything you did not
think to measure.

Ask before inventing. If the samples have no chart style and the content wants a
chart, say which way you went and why.

## 4. Check

```bash
python3 scripts/style.py check draft.pptx --spec style.json
```

Exit 0 clean · 1 warnings · 2 off-style. It flags:

| | level | |
|---|---|---|
| `font` | error | a typeface outside the house set |
| `geometry` | error | page or slide size that doesn't match |
| `color` | warn | a colour outside the palette (black and white exempt) |
| `size` | warn | a point size off the ladder |
| `styles` | warn | house named styles missing from the file |
| `density` | warn | more than twice, or less than half, the house words per slide or page |
| `sentences` | warn | median sentence far longer than the house |
| `punctuation` | warn | fragments where the house writes sentences, or the reverse |
| `voice` | warn | first or second person, or exclamation marks, the samples do not use |
| `titles` | warn | headings that assert where the house labels |

Warnings are often legitimate — a new accent for a callout, a size the samples
happened not to contain. Errors rarely are. Judge them; do not suppress them
silently, and say in your handover which warnings you decided to keep and why.

## Honest limits

- The check reads structure, not layout. It cannot see that a title overflows its
  box, that two elements collide, or that a slide is unbalanced. Render and look
  before delivering.
- PDF extraction reports the text block's inset, not a declared margin — a short
  line does not prove a wide margin.
- `.doc`, `.ppt`, `.key`, `.pages`, and Google formats are not OOXML and are not
  read. Ask for an exported `.docx` / `.pptx` / `.pdf`.
- A single sample gives a thin spec. Three is where it gets reliable.

## Files

- `scripts/style.py` — `extract` and `check`. Standard library, plus PyMuPDF for PDF
- `references/spec.md` — every field, where it comes from, how far to trust it
- `references/voice.md` — reading tone and structure from samples, and the
  handover checklist
