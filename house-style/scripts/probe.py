#!/usr/bin/env python3
"""How much does your spec actually protect? Break one house decision at a time.

    python3 probe.py <document> --spec style.json [--keep DIR]

`check` compares a document against a spec. Nothing compares the spec against
reality — a spec that passes everything you show it is not a spec, and you find
that out from the document that shipped.

So: take a document that passes, produce one copy per house decision with that
decision and only that decision broken, and run `check` on each. What comes back
is the list of things your spec can see, and — the useful half — the list of
things it cannot.

Rewrites the OOXML in place with the standard library. Nothing to install.
"""
import sys, os, re, json, shutil, zipfile, argparse, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
STYLE = os.path.join(HERE, 'style.py')


def parts(z, kind):
    """Body parts (slides / the document) as opposed to themes and masters."""
    n = z.namelist()
    if kind == 'pptx':
        body = [p for p in n if re.match(r'ppt/slides/slide\d+\.xml$', p)]
        theme = [p for p in n if re.match(r'ppt/theme/theme\d+\.xml$', p)]
        pres = [p for p in n if p == 'ppt/presentation.xml']
    else:
        body = [p for p in n if p in ('word/document.xml',)]
        theme = [p for p in n if p.startswith('word/theme/')]
        pres = body
    return body, theme, pres


def rewrite(src, dst, edits):
    """edits: {part_name: fn(text) -> text or None}. None means 'nothing to change'."""
    touched = False
    with zipfile.ZipFile(src) as z:
        names = z.namelist()
        data = {n: z.read(n) for n in names}
    for name, fn in edits.items():
        if name not in data:
            continue
        try:
            text = data[name].decode('utf-8')
        except UnicodeDecodeError:
            continue
        out = fn(text)
        if out is not None and out != text:
            data[name] = out.encode('utf-8'); touched = True
    if not touched:
        return False
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, data[n])
    return True


def sub_first(pattern, repl):
    def fn(text):
        new, n = re.subn(pattern, repl, text, count=1)
        return new if n else None
    return fn


def sub_all(pattern, repl):
    def fn(text):
        new, n = re.subn(pattern, repl, text)
        return new if n else None
    return fn


def bump_pptx_size(text):
    def one(m):
        return m.group(0).replace(m.group(1), str(int(m.group(1)) + 900))
    new, n = re.subn(r'sz="(\d{3,5})"', one, text, count=3)
    return new if n else None


def bump_docx_size(text):
    def one(m):
        return m.group(0).replace('"' + m.group(1) + '"', '"%d"' % (int(m.group(1)) + 7))
    new, n = re.subn(r'<w:sz w:val="(\d{1,3})"\s*/>', one, text, count=3)
    return new if n else None


# Most real templates carry no explicit formatting at all — every run inherits
# from the theme and the layout — so a mutation that REPLACES a typeface or a
# colour finds nothing to replace and the dimension goes untested. Three real
# files in a row reported "nothing to break" for fonts, palette and sizes. So
# when there is nothing to overwrite, apply some: that is the drift that actually
# happens, someone reaching for the font menu.
# One property per mutation, or the rows are not independent and the coverage
# count is a lie: a single rPr carrying a face, a colour and a size made three
# separate rows all report "font, color, size" and all three count as covered
# when only one thing had been tested.
PPTX_RPR = {'font': '<a:latin typeface="Impact"/>',
            'color': '<a:solidFill><a:srgbClr val="D91C21"/></a:solidFill>',
            'size': None}          # size lives on the rPr element itself
DOCX_RPR = {'font': '<w:rFonts w:ascii="Impact" w:hAnsi="Impact"/>',
            'color': '<w:color w:val="D91C21"/>',
            'size': '<w:sz w:val="53"/><w:szCs w:val="53"/>'}


def apply_pptx(prop):
    def fn(text):
        rpr = ('<a:rPr lang="en-GB" sz="5300" dirty="0"/>' if prop == 'size'
               else '<a:rPr lang="en-GB" dirty="0">' + PPTX_RPR[prop] + '</a:rPr>')
        new, n = re.subn(r'<a:r>(?!\s*<a:rPr)', '<a:r>' + rpr, text, count=2)
        return new if n else None
    return fn


def apply_docx(prop):
    def fn(text):
        new, n = re.subn(r'<w:r>(?!\s*<w:rPr)', '<w:r><w:rPr>' + DOCX_RPR[prop] + '</w:rPr>', text, count=2)
        return new if n else None
    return fn


def first_that_works(*fns):
    """Try to break a decision by overwriting it; failing that, by applying it."""
    def fn(text):
        for f in fns:
            out = f(text)
            if out is not None:
                return out
        return None
    return fn


LONG = ('We are delighted to be able to report that the programme has now delivered '
        'substantially all of the outcomes that we set out to achieve at the start')


def wordy_headings(text):
    """Replace the shortest few text runs with a long first-person sentence."""
    runs = list(re.finditer(r'<(a|w):t(?:\s[^>]*)?>([^<]{4,40})</(?:a|w):t>', text))
    if not runs:
        return None
    runs.sort(key=lambda m: len(m.group(2)))
    out, done = text, 0
    for m in runs:
        if done >= 3:
            break
        out = out.replace(m.group(0), m.group(0).replace('>' + m.group(2) + '<', '>' + LONG + '<'), 1)
        done += 1
    return out if done else None


def build(kind, body, theme, pres):
    """The house decisions a spec claims to pin, one mutation each."""
    m = []
    m.append(('theme typeface', {p: sub_all(r'typeface="[^"]*"', 'typeface="Impact"') for p in theme}))
    if kind == 'pptx':
        applied = apply_pptx
        run_font = sub_first(r'typeface="[^"]*"', 'typeface="Impact"')
        run_col = sub_first(r'srgbClr val="[0-9A-Fa-f]{6}"', 'srgbClr val="D91C21"')
        run_size = bump_pptx_size
    else:
        applied = apply_docx
        run_font = sub_first(r'(<w:rFonts[^>]*w:ascii=")[^"]*"', r'\1Impact"')
        run_col = sub_first(r'(<w:color w:val=")[0-9A-Fa-f]{6}"', r'\1D91C21"')
        run_size = bump_docx_size
    m.append(('run typeface', {p: first_that_works(run_font, applied('font')) for p in body}))
    m.append(('palette', {p: first_that_works(run_col, applied('color')) for p in body}))
    m.append(('size ladder', {p: first_that_works(run_size, applied('size')) for p in body}))
    if kind == 'pptx':
        m.append(('page geometry', {p: sub_first(r'<p:sldSz[^/]*/>', '<p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>') for p in pres}))
    else:
        m.append(('page geometry', {p: sub_first(r'(<w:pgSz[^>]*w:w=")\d+(" w:h=")\d+"', r'\g<1>11906\g<2>16838"') for p in body}))
    m.append(('voice: wordy, first person', {p: wordy_headings for p in body}))
    return m


def run_check(path, spec):
    r = subprocess.run([sys.executable, STYLE, 'check', path, '--spec', spec],
                       capture_output=True, text=True)
    lines = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith(('x ', '! '))]
    tags = []
    for l in lines:
        t = re.search(r'\[(\w+)\]', l)
        if t and t.group(1) not in tags:
            tags.append(t.group(1))
    # A non-zero exit with nothing to parse is the tool failing, not the document
    # being off-style — a missing spec file reported as "does not pass its own
    # spec ()", which sent me looking at the wrong thing for ten minutes.
    if r.returncode != 0 and not tags:
        why = (r.stderr.strip() or r.stdout.strip() or 'no output').splitlines()
        return r.returncode, ['!' + why[-1][:120]]
    return r.returncode, tags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('document')
    ap.add_argument('--spec', required=True)
    ap.add_argument('--keep', help='write the broken copies here instead of a temp dir')
    a = ap.parse_args()

    kind = 'pptx' if a.document.lower().endswith('.pptx') else 'docx'
    with zipfile.ZipFile(a.document) as z:
        body, theme, pres = parts(z, kind)

    base_rc, base_tags = run_check(a.document, a.spec)
    print(f"\nprobe — {os.path.basename(a.document)} against {os.path.basename(a.spec)}\n")
    if base_rc != 0:
        if base_tags and base_tags[0].startswith('!'):
            print(f"  check could not run: {base_tags[0][1:]}\n")
            return 4
        print(f"  the document does not pass its own spec ({', '.join(base_tags)}).")
        print("  probing a document that already fails tells you nothing. Fix that first.\n")
        return 3

    out = a.keep or tempfile.mkdtemp(prefix='probe-')
    os.makedirs(out, exist_ok=True)
    caught = blind = 0
    rows = []
    for name, edits in build(kind, body, theme, pres):
        dst = os.path.join(out, re.sub(r'\W+', '-', name) + '.' + kind)
        if not rewrite(a.document, dst, edits):
            rows.append((name, 'n/a', 'nothing in this document to break'))
            continue
        rc, tags = run_check(dst, a.spec)
        if rc != 0:
            caught += 1; rows.append((name, 'caught', ', '.join(tags)))
        else:
            blind += 1; rows.append((name, 'BLIND', 'the spec says nothing'))

    w = max(len(r[0]) for r in rows)
    for name, verdict, detail in rows:
        mark = {'caught': ' ok  ', 'BLIND': '  x  ', 'n/a': ' --  '}[verdict]
        print(f"  {mark}{name.ljust(w)}   {detail}")
    print(f"\n  {caught} of the {caught + blind} decisions this document could break are covered.")
    if blind:
        print(f"  {blind} went through untouched — that is what your spec does not defend.")
    if not a.keep:
        shutil.rmtree(out, ignore_errors=True)
    else:
        print(f"\n  broken copies kept in {out}")
    return 1 if blind else 0


if __name__ == '__main__':
    sys.exit(main())
