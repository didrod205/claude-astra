# The spec file

`style.py extract` writes one JSON object. The printed summary is the merged
house style; `samples[]` keeps each source file's own reading, which is what you
look at when two samples disagree.

## Top level

| field | is |
|---|---|
| `from` | the sample filenames |
| `kinds` | how many of each format |
| `fonts` | every typeface seen, commonest first |
| `palette` | every colour seen as `RRGGBB`, commonest first |
| `sizes_pt` | the point-size ladder, ascending |
| `geometry` | `page_in` / `slide_in` / `margins_in` / `text_inset_in`, in inches |
| `layouts` | slide layout names across all pptx samples |
| `named_styles` | style ids across all docx samples |
| `samples` | the per-file readings |

## Where each thing comes from

**Theme** (`<theme>` in each sample) — `word|ppt|xl/theme/theme1.xml`. The
`clrScheme` gives `dk1 lt1 dk2 lt2 accent1..6 hlink folHlink`; the `fontScheme`
gives the major (headings) and minor (body) latin faces. **This is the most
reliable signal in the file** — it is what the template author actually chose.

**Used fonts and colours** — scraped from the content parts (`word/document.xml`,
`ppt/slides/*.xml`, headers, footers, masters). This is what the document really
does, which frequently differs from the theme: someone hard-coded a hex, or
pasted in text carrying another face.

When the theme and the used set disagree, **the theme is the intent and the used
set is the practice.** Follow the theme, and mention the drift if it is large —
it is often something the user would want to know.

**Sizes** — docx: `w:sz` in named styles (half-points, halved). xlsx:
`xl/styles.xml` fonts. pdf: the span sizes weighted by how much text is set in
them. pptx sizes are usually in layouts rather than declared per run, so a deck
may report no ladder; read the layouts instead.

**Geometry** — docx `w:sectPr/w:pgSz` and `w:pgMar` in twips (÷1440). pptx
`p:sldSz` in EMU (÷914400): `13.33 × 7.5` is 16:9, `10 × 7.5` is 4:3. pdf: the
page rect in points (÷72).

**Layouts** — the `name` on each `slideLayout*.xml`. These are the deck's real
vocabulary — "Section Header", "Two Content", "Title and Chart" — and building
new slides from the existing layout names is the single biggest lever on whether
a deck looks native. A layout list is worth more than any colour value.

**Named styles** — `word/styles.xml`, with the font, point size, and colour each
declares. Use the style, don't reproduce its formatting inline; a heading that
looks like Heading 1 but is not Heading 1 breaks the navigation pane, the table
of contents, and every later restyle.

## How far to trust it

| high | it came from the theme or an explicit declaration: theme fonts and colours, page and slide size, docx margins, layout names, named styles |
| medium | scraped fonts and colours — real, but may include one-off pastes |
| low | the PDF size ladder on a short document, and `text_inset_in`, which measures where text sits rather than a declared margin |

Nothing here reads the writing. That is `references/voice.md`.

## Merging disagreeing samples

`extract` unions everything and orders by frequency, so a face used in one sample
and a face used in all three both appear — the common one first. When it matters
which is canonical, open `samples[]` and compare. If the samples genuinely differ
(an old template and a new one), ask which is current rather than averaging them.

## Extending

`check()` in `style.py` is a short list of comparisons. Adding one — a required
footer, a logo in a fixed position, a forbidden font — is a few lines in the same
shape. Keep checks to things that are true or false in the file; leave judgement
to the handover.
