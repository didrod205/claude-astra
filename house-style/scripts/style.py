#!/usr/bin/env python3
"""Extract a house style from the user's own documents, and check new ones against it.

    python3 style.py extract <sample>... -o style.json
    python3 style.py check   <produced>... --spec style.json

Reads .docx / .pptx / .xlsx as what they are (zipped OOXML) using only the
standard library, and .pdf via PyMuPDF when it is installed. Nothing else needed.

The point is not to describe a document. It is to pin down the handful of
decisions that make output look like it came from the same place: which
typefaces, which colours, which sizes, which page geometry.
"""
import sys, os, json, zipfile, argparse, re
from collections import Counter
import xml.etree.ElementTree as ET

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    's': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
    'dc': 'http://purl.org/dc/elements/1.1/',
}
EMU_IN = 914400.0
TWIP_IN = 1440.0


def _xml(z, name):
    try:
        return ET.fromstring(z.read(name))
    except (KeyError, ET.ParseError):
        return None


def _norm_hex(v):
    if not v:
        return None
    v = v.strip().lstrip('#').upper()
    return v if re.fullmatch(r'[0-9A-F]{6}', v) else None


# ----------------------------------------------------------------- OOXML ----

def theme_of(z):
    """The theme is the source of truth for an Office file's fonts and palette."""
    name = next((n for n in z.namelist()
                 if re.fullmatch(r'(word|ppt|xl)/theme/theme\d+\.xml', n)), None)
    if not name:
        return {}
    root = _xml(z, name)
    if root is None:
        return {}
    out = {'colors': {}, 'fonts': {}}
    scheme = root.find('.//a:clrScheme', NS)
    for child in (scheme if scheme is not None else []):
        tag = child.tag.split('}')[-1]
        srgb = child.find('a:srgbClr', NS)
        sysc = child.find('a:sysClr', NS)
        val = (srgb.get('val') if srgb is not None
               else sysc.get('lastClr') if sysc is not None else None)
        if _norm_hex(val):
            out['colors'][tag] = _norm_hex(val)
    for kind in ('major', 'minor'):
        el = root.find(f'.//a:{kind}Font/a:latin', NS)
        if el is not None and el.get('typeface'):
            out['fonts'][kind] = el.get('typeface')
    return out


def scan_used(z, patterns):
    """What the document ACTUALLY uses, which is often not what the theme says."""
    fonts, colors, sizes = Counter(), Counter(), Counter()
    for n in z.namelist():
        if not any(re.fullmatch(p, n) for p in patterns):
            continue
        try:
            blob = z.read(n).decode('utf-8', 'ignore')
        except KeyError:
            continue
        for m in re.finditer(r'typeface="([^"]+)"', blob):
            if not m.group(1).startswith('+'):
                fonts[m.group(1)] += 1
        for m in re.finditer(r'w:ascii="([^"]+)"', blob):
            fonts[m.group(1)] += 1
        for m in re.finditer(r'<a:srgbClr val="([0-9A-Fa-f]{6})"', blob):
            colors[m.group(1).upper()] += 1
        for m in re.finditer(r'w:color w:val="([0-9A-Fa-f]{6})"', blob):
            colors[m.group(1).upper()] += 1
        # docx: w:sz is half-points. drawingml (pptx): sz is hundredths of a point.
        for m in re.finditer(r'w:sz w:val="(\d+)"', blob):
            sizes[int(m.group(1)) / 2] += 1
        # a:rPr on a slide run, a:defRPr in a master/layout list style.
        for m in re.finditer(r'<a:(?:defR|r)Pr[^>]*\bsz="(\d+)"', blob):
            sizes[int(m.group(1)) / 100] += 1
    return fonts, colors, sizes


def read_docx(z):
    d = {'kind': 'docx'}
    d['theme'] = theme_of(z)
    styles = {}
    root = _xml(z, 'word/styles.xml')
    if root is not None:
        for st in root.findall('w:style', NS):
            sid = st.get(f'{{{NS["w"]}}}styleId')
            nm = st.find('w:name', NS)
            rpr = st.find('w:rPr', NS)
            entry = {'name': nm.get(f'{{{NS["w"]}}}val') if nm is not None else sid,
                     'type': st.get(f'{{{NS["w"]}}}type')}
            if rpr is not None:
                f = rpr.find('w:rFonts', NS)
                sz = rpr.find('w:sz', NS)
                col = rpr.find('w:color', NS)
                if f is not None and f.get(f'{{{NS["w"]}}}ascii'):
                    entry['font'] = f.get(f'{{{NS["w"]}}}ascii')
                if sz is not None and sz.get(f'{{{NS["w"]}}}val'):
                    entry['pt'] = int(sz.get(f'{{{NS["w"]}}}val')) / 2
                if col is not None and _norm_hex(col.get(f'{{{NS["w"]}}}val')):
                    entry['color'] = _norm_hex(col.get(f'{{{NS["w"]}}}val'))
            if sid:
                styles[sid] = entry
    d['styles'] = styles

    doc = _xml(z, 'word/document.xml')
    if doc is not None:
        sect = doc.find('.//w:sectPr', NS)
        if sect is not None:
            pg = sect.find('w:pgSz', NS)
            mar = sect.find('w:pgMar', NS)
            if pg is not None:
                d['page_in'] = [round(int(pg.get(f'{{{NS["w"]}}}{k}', 0)) / TWIP_IN, 2)
                                for k in ('w', 'h')]
            if mar is not None:
                d['margins_in'] = {k: round(int(mar.get(f'{{{NS["w"]}}}{k}', 0)) / TWIP_IN, 2)
                                   for k in ('top', 'right', 'bottom', 'left')}
    d['prose'] = prose_docx(z)
    f, c, sz = scan_used(z, [r'word/document\.xml', r'word/header\d*\.xml', r'word/footer\d*\.xml'])
    d['fonts_used'] = dict(f.most_common(12))
    d['colors_used'] = dict(c.most_common(16))
    d['sizes_pt'] = sorted(sz)
    return d


def slide_layout_names(z):
    """Which layout each slide actually sits on, by name. The list of layouts in
    the file is the available vocabulary; this is the vocabulary in use."""
    names = {}
    for n in z.namelist():
        m = re.fullmatch(r'ppt/slideLayouts/(slideLayout\d+)\.xml', n)
        if not m:
            continue
        root = _xml(z, n)
        cs = root.find('.//p:cSld', NS) if root is not None else None
        if cs is not None and cs.get('name'):
            names[m.group(1)] = cs.get('name')
    used = []
    for n in sorted(x for x in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', x)):
        rel = f'ppt/slides/_rels/{os.path.basename(n)}.rels'
        try:
            blob = z.read(rel).decode('utf-8', 'ignore')
        except KeyError:
            continue
        m = re.search(r'Target="[^"]*?(slideLayout\d+)\.xml"', blob)
        used.append(names.get(m.group(1)) if m else None)
    return used


def read_pptx(z):
    d = {'kind': 'pptx'}
    d['theme'] = theme_of(z)
    pres = _xml(z, 'ppt/presentation.xml')
    if pres is not None:
        sz = pres.find('p:sldSz', NS)
        if sz is not None:
            d['slide_in'] = [round(int(sz.get('cx', 0)) / EMU_IN, 2),
                             round(int(sz.get('cy', 0)) / EMU_IN, 2)]
    layouts = []
    for n in sorted(x for x in z.namelist()
                    if re.fullmatch(r'ppt/slideLayouts/slideLayout\d+\.xml', x)):
        root = _xml(z, n)
        if root is None:
            continue
        cs = root.find('.//p:cSld', NS)
        layouts.append({'file': os.path.basename(n),
                        'name': cs.get('name') if cs is not None else None,
                        'type': root.get('type')})
    d['layouts'] = layouts
    d['slide_count'] = sum(1 for x in z.namelist()
                           if re.fullmatch(r'ppt/slides/slide\d+\.xml', x))
    d['layouts_used'] = [x for x in slide_layout_names(z) if x]
    d['prose'] = prose_pptx(z)
    f, c, sz = scan_used(z, [r'ppt/slides/slide\d+\.xml',
                             r'ppt/slideMasters/slideMaster\d+\.xml',
                             r'ppt/slideLayouts/slideLayout\d+\.xml'])
    d['fonts_used'] = dict(f.most_common(12))
    d['colors_used'] = dict(c.most_common(16))
    d['sizes_pt'] = sorted(sz)
    return d


def read_xlsx(z):
    d = {'kind': 'xlsx'}
    d['theme'] = theme_of(z)
    fonts, sizes = Counter(), Counter()
    root = _xml(z, 'xl/styles.xml')
    if root is not None:
        for fo in root.findall('.//s:fonts/s:font', NS):
            nm = fo.find('s:name', NS)
            sz = fo.find('s:sz', NS)
            if nm is not None and nm.get('val'):
                fonts[nm.get('val')] += 1
            if sz is not None and sz.get('val'):
                sizes[float(sz.get('val'))] += 1
    d['fonts_used'] = dict(fonts.most_common(12))
    d['sizes_pt'] = sorted(sizes)
    d['sheets'] = [m.group(1) for n in z.namelist()
                   for m in [re.fullmatch(r'xl/worksheets/(sheet\d+)\.xml', n)] if m]
    _, c, _sz = scan_used(z, [r'xl/styles\.xml', r'xl/theme/theme\d+\.xml'])
    d['colors_used'] = dict(c.most_common(16))
    return d


def read_pdf(path):
    try:
        import fitz
    except ImportError:
        return {'kind': 'pdf', 'error': 'PyMuPDF (fitz) is not installed; cannot read PDF samples'}
    doc = fitz.open(path)
    fonts, sizes, colors = Counter(), Counter(), Counter()
    left = bottomright = None
    page_in = None
    for i, page in enumerate(doc):
        if page_in is None:
            page_in = [round(page.rect.width / 72, 2), round(page.rect.height / 72, 2)]
        for blk in page.get_text('dict')['blocks']:
            for line in blk.get('lines', []):
                for sp in line['spans']:
                    fam = sp['font'].split('+')[-1]
                    fonts[fam] += len(sp['text'])
                    sizes[round(sp['size'], 1)] += len(sp['text'])
                    colors['%06X' % (sp['color'] & 0xFFFFFF)] += len(sp['text'])
                    x0, y0, x1, y1 = sp['bbox']
                    left = x0 if left is None else min(left, x0)
                    bottomright = (max(x1, bottomright[0]), max(y1, bottomright[1])) if bottomright else (x1, y1)
        if i >= 19:
            break
    d = {'kind': 'pdf', 'pages': doc.page_count, 'page_in': page_in, 'prose': prose_pdf(path),
         'fonts_used': dict(fonts.most_common(12)),
         'sizes_pt': [s for s, _ in sizes.most_common(10)],
         'colors_used': dict(colors.most_common(16))}
    # Measured from where text actually sits, so this is the text block's inset,
    # not a declared margin — a short line does not prove a wide right margin.
    if left is not None and page_in:
        d['text_inset_in'] = {'left': round(left / 72, 2)}
    return d


# ------------------------------------------------------------------ prose ---
# The visual system is half a house style. The other half - how long a sentence
# runs, how many words go on a slide, whether a bullet ends in a full stop - is
# usually called unmeasurable and then quietly ignored. Most of it is countable.

_WS = re.compile(r'\s+')
_SENT = re.compile(r'[.!?\u3002\uff01\uff1f]+(?=\s|$)')
_FIRST = re.compile(r'\b(we|our|us|i|my)\b', re.I)
_SECOND = re.compile(r'\b(you|your)\b', re.I)
_HEDGE = re.compile(r'\b(may|might|could|appears?|suggests?|likely|potentially|seems?)\b', re.I)
_TAGRE = re.compile(r'<[^>]+>')


def _words(t):
    t = t.strip()
    return len(_WS.split(t)) if t else 0


def _paras_ooxml(blob, ptag, ttag):
    """Split one part into paragraphs and pull the text runs out of each."""
    out = []
    for chunk in re.split(rf'<{ptag}[ >]', blob)[1:]:
        chunk = chunk.split(f'</{ptag}>')[0]
        txt = ''.join(re.findall(rf'<{ttag}[^>]*>(.*?)</{ttag}>', chunk, re.S))
        txt = _TAGRE.sub('', txt)
        for a, b in (('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'), ('&#39;', "'")):
            txt = txt.replace(a, b)
        out.append({'text': txt.strip(), 'raw': chunk})
    return out


def prose_docx(z):
    try:
        blob = z.read('word/document.xml').decode('utf-8', 'ignore')
    except KeyError:
        return None
    paras = _paras_ooxml(blob, 'w:p', 'w:t')
    body, heads, bullets = [], [], 0
    for p in paras:
        if not p['text']:
            continue
        style = re.search(r'w:pStyle w:val="([^"]+)"', p['raw'])
        st = style.group(1) if style else ''
        if st.lower().startswith('heading') or st.lower() == 'title':
            heads.append(p['text'])
        else:
            body.append(p['text'])
            if 'w:numPr' in p['raw'] or 'listparagraph' in st.lower():
                bullets += 1
    return _prose(body, heads, bullets, unit='page', units=max(1, len(body) // 18 + 1))


def prose_pptx(z):
    slides = sorted(n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n))
    body, heads, bullets, per = [], [], 0, []
    for n in slides:
        blob = z.read(n).decode('utf-8', 'ignore')
        # The title is the shape carrying a title placeholder, not whichever
        # paragraph happens to be serialised first — PowerPoint reorders shapes,
        # and taking paras[0] measures a bullet as the heading when it does.
        title, rest = None, []
        for shape in re.split(r'<p:sp[ >]', blob)[1:]:
            shape = shape.split('</p:sp>')[0]
            texts = [p['text'] for p in _paras_ooxml(shape, 'a:p', 'a:t') if p['text']]
            if not texts:
                continue
            if re.search(r'<p:ph[^>]*type="(ctrTitle|title)"', shape) and title is None:
                title = texts[0]
                rest += texts[1:]
            else:
                rest += texts
        if title is None and rest:
            title = rest.pop(0)
        if title is None and not rest:
            per.append(0); continue
        if title:
            heads.append(title)
        body += rest
        bullets += len(rest)
        per.append(sum(_words(t) for t in rest) + _words(title or ''))
    if not slides:
        return None
    d = _prose(body, heads, bullets, unit='slide', units=len(slides), heading_words=True)
    d['bullets_per_unit'] = round(bullets / max(1, len(slides)), 1)
    return d


def prose_pdf(path):
    try:
        import fitz
    except ImportError:
        return None
    doc = fitz.open(path)
    pages = [page.get_text() for page in doc][:40]
    body = [ln.strip() for pg in pages for ln in pg.splitlines() if ln.strip()]
    return _prose(body, [], 0, unit='page', units=max(1, len(pages)))


_TERMINAL = ('.', '!', '?', '\u3002', '\uff01', '\uff1f')


def _prose(body, heads, bullets, unit, units, heading_words=False):
    # `words_total` and `words_per_unit` count the same words. A deck's density
    # includes its slide titles; a report's does not count its headings twice.
    text = ' '.join(body + (heads if heading_words else []))
    words = _words(text)
    # Split sentences WITHIN each block. Joining first merges a whole deck of
    # unpunctuated fragments into one 31-word "sentence" that exists nowhere.
    slen = []
    for b in body:
        parts = [x for x in _SENT.split(b) if x.strip()] or ([b] if b.strip() else [])
        slen += [_words(x) for x in parts]
    slen = sorted(slen) or [0]
    hl = sorted(_words(h) for h in heads) or [0]
    ends = [b for b in body if b]
    period = sum(1 for b in ends if b.rstrip().endswith(_TERMINAL)) / max(1, len(ends))
    return {
        'unit': unit, 'units': units,
        'words_total': words,
        'words_per_unit': round(words / max(1, units), 1),
        'blocks': len(body),
        'sentence_words_median': slen[len(slen) // 2],
        'sentence_words_p90': slen[int(len(slen) * 0.9) - 1] if slen else 0,
        'sentence_words_max': slen[-1],
        'bullets': bullets,
        'bullets_per_unit': round(bullets / max(1, units), 1),
        'block_ends_with_period': round(period, 2),
        'heading_words_median': hl[len(hl) // 2],
        'heading_words_max': hl[-1],
        'first_person_per_1k': round(len(_FIRST.findall(text)) * 1000 / max(1, words), 1),
        'second_person_per_1k': round(len(_SECOND.findall(text)) * 1000 / max(1, words), 1),
        'hedges_per_1k': round(len(_HEDGE.findall(text)) * 1000 / max(1, words), 1),
        'exclamations': text.count('!'),
    }


READERS = {'.docx': read_docx, '.dotx': read_docx, '.pptx': read_pptx,
           '.potx': read_pptx, '.xlsx': read_xlsx, '.xltx': read_xlsx}


def read_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.pdf':
        d = read_pdf(path)
    elif ext in READERS:
        with zipfile.ZipFile(path) as z:
            d = READERS[ext](z)
    else:
        return {'error': f'unsupported: {ext}'}
    d['file'] = os.path.basename(path)
    return d


# ----------------------------------------------------------------- spec -----

def build_spec(samples):
    docs = [read_any(p) for p in samples]
    fonts, colors, sizes = Counter(), Counter(), Counter()
    kinds = Counter()
    for d in docs:
        if d.get('error'):
            continue
        kinds[d.get('kind')] += 1
        for f, n in (d.get('fonts_used') or {}).items():
            fonts[f] += n
        for c, n in (d.get('colors_used') or {}).items():
            colors[c] += n
        for f in (d.get('theme') or {}).get('fonts', {}).values():
            fonts[f] += 1
        for c in (d.get('theme') or {}).get('colors', {}).values():
            colors[c] += 1
        for s in d.get('sizes_pt') or []:
            sizes[s] += 1
        for st in (d.get('styles') or {}).values():
            if st.get('font'):
                fonts[st['font']] += 1
            if st.get('pt'):
                sizes[st['pt']] += 1
            if st.get('color'):
                colors[st['color']] += 1

    geometry = {}
    for d in docs:
        for k in ('page_in', 'slide_in', 'margins_in', 'text_inset_in'):
            if d.get(k) and k not in geometry:
                geometry[k] = d[k]

    # Merge the prose measurements per unit kind (slide vs page): they are not
    # comparable across formats, so a deck and a report keep separate budgets.
    prose = {}
    for d in docs:
        pr = d.get('prose')
        # A stock template contributes theme, ladder and geometry but no writing.
        # Averaging its zeros in prints "0 words/slide" as though it were a
        # finding about the client's house style.
        if not pr or not pr.get('words_total'):
            continue
        b = prose.setdefault(pr['unit'], {'n': 0})
        b['n'] += 1
        for k, v in pr.items():
            if isinstance(v, (int, float)):
                b[k] = b.get(k, 0) + v
    for unit, b in prose.items():
        n = b.pop('n')
        for k in list(b):
            b[k] = round(b[k] / n, 2)
        b['unit'] = unit
        b['samples'] = n

    return {
        'prose': prose,
        'from': [d.get('file') for d in docs],
        'kinds': dict(kinds),
        'fonts': [f for f, _ in fonts.most_common()],
        'palette': [c for c, _ in colors.most_common()],
        'sizes_pt': sorted(sizes),
        'geometry': geometry,
        'layouts': [l.get('name') for d in docs for l in (d.get('layouts') or []) if l.get('name')],
        'named_styles': sorted({k for d in docs for k in (d.get('styles') or {})}),
        'samples': docs,
    }


def check(produced, spec):
    ok_fonts = {f.lower() for f in spec.get('fonts', [])}
    ok_colors = set(spec.get('palette', []))
    ok_sizes = set(spec.get('sizes_pt', []))
    problems = []
    for path in produced:
        d = read_any(path)
        base = os.path.basename(path)
        if d.get('error'):
            problems.append(('error', base, 'read', d['error']))
            continue

        # The theme, as well as what the runs say. extract() folds a document's
        # theme fonts and colours into the spec (see build_spec) while check()
        # used to compare only what was explicitly applied — so the two halves
        # were looking at different places. A deck built the way corporate
        # templates are built, with every run inheriting from the theme and no
        # explicit formatting anywhere, therefore had NOTHING to check: swapping
        # its entire font scheme to Impact passed clean on three different real
        # files. Three of the five structural checks were inert on exactly the
        # documents most likely to be handed to this tool.
        theme = d.get('theme') or {}
        used_fonts = set((d.get('fonts_used') or {}))
        used_fonts |= {f for f in (theme.get('fonts') or {}).values() if f}
        for st in (d.get('styles') or {}).values():
            if st.get('font'):
                used_fonts.add(st['font'])
        off = sorted(f for f in used_fonts if f.lower() not in ok_fonts)
        if off:
            problems.append(('error', base, 'font',
                             f"typefaces not in the house set: {', '.join(off[:6])}"))

        used_colors = set(d.get('colors_used') or {})
        used_colors |= {c for c in (theme.get('colors') or {}).values() if c}
        for st in (d.get('styles') or {}).values():
            if st.get('color'):
                used_colors.add(st['color'])
        offc = sorted(c for c in used_colors
                      if c not in ok_colors and c not in ('000000', 'FFFFFF'))
        if offc:
            problems.append(('warn', base, 'color',
                             f"colours outside the palette: {', '.join('#' + c for c in offc[:8])}"))

        for key in ('page_in', 'slide_in'):
            want, got = spec.get('geometry', {}).get(key), d.get(key)
            if want and got and [round(v, 1) for v in want] != [round(v, 1) for v in got]:
                problems.append(('error', base, 'geometry',
                                 f"{key} is {got} but the house style is {want}"))

        if ok_sizes and d.get('sizes_pt'):
            offs = sorted(s for s in d['sizes_pt'] if s not in ok_sizes)
            if offs:
                problems.append(('warn', base, 'size',
                                 f"point sizes not in the house ladder: {offs[:8]}"))

        # --- prose: density and habit, the half people skip -------------------
        pr, want = d.get('prose'), (spec.get('prose') or {}).get((d.get('prose') or {}).get('unit'))
        if pr and want:
            u = pr['unit']
            wpu, wantwpu = pr['words_per_unit'], want.get('words_per_unit', 0)
            if wantwpu >= 5:
                if wpu > wantwpu * 2:
                    problems.append(('warn', base, 'density',
                        f"{wpu:.0f} words per {u} against a house average of {wantwpu:.0f} — more than twice as dense"))
                elif wpu < wantwpu * 0.5:
                    problems.append(('warn', base, 'density',
                        f"{wpu:.0f} words per {u} against a house average of {wantwpu:.0f} — less than half as dense"))
            ws, wants = pr['sentence_words_median'], want.get('sentence_words_median', 0)
            # Needs both a ratio and an absolute gap, so a 3 -> 5 word wobble on a
            # small sample stays quiet while 3 -> 31 does not.
            if wants >= 2 and ws > max(wants * 1.6, wants + 6):
                problems.append(('warn', base, 'sentences',
                    f"median sentence is {ws:.0f} words against the house {wants:.0f}"))
            pe, wantpe = pr['block_ends_with_period'], want.get('block_ends_with_period', 0)
            if wantpe >= 0.7 and pe <= 0.3:
                problems.append(('warn', base, 'punctuation', 'house blocks end in a full stop; these mostly do not'))
            elif wantpe <= 0.3 and pe >= 0.7:
                problems.append(('warn', base, 'punctuation', 'house blocks do not end in a full stop; these mostly do'))
            for key, label in (('first_person_per_1k', 'first person'), ('second_person_per_1k', 'second person')):
                if want.get(key, 0) < 1.0 and pr.get(key, 0) > 4.0:
                    problems.append(('warn', base, 'voice',
                        f"{label} appears {pr[key]:.0f}x per 1000 words; the samples barely use it"))
            if want.get('exclamations', 0) == 0 and pr.get('exclamations', 0) > 0:
                problems.append(('warn', base, 'voice', f"{pr['exclamations']} exclamation mark(s); the samples use none"))
            hw, wanthw = pr['heading_words_median'], want.get('heading_words_median', 0)
            if 0 < wanthw <= 4 and hw >= wanthw * 2.5:
                problems.append(('warn', base, 'titles',
                    f"headings run {hw:.0f} words against the house {wanthw:.0f} — the samples label, these assert"))

        # Layouts: spec.md calls them the deck's real vocabulary and worth more
        # than any colour value, and until now check() never looked at them.
        house_layouts = set(spec.get('layouts') or [])
        used = d.get('layouts_used') or []
        if house_layouts and used:
            off = sorted({u for u in used if u not in house_layouts})
            if off:
                problems.append(('error', base, 'layout',
                    f"slides built on layouts that are not in the house set: {', '.join(off[:5])}. "
                    'Building from the deck\'s own layouts is what makes it look native'))

        # A median over a whole file hides one bad slide behind its conforming
        # siblings, which is exactly the slide a person notices first.
        if pr and want:
            hm, wanthm = pr.get('heading_words_max', 0), want.get('heading_words_median', 0)
            if 0 < wanthm <= 4 and hm >= max(wanthm * 3, 8):
                problems.append(('warn', base, 'titles',
                    f"one heading runs {hm:.0f} words against a house median of {wanthm:.0f} — "
                    'the file average hides it'))
            # A p90 cannot see one outlier among a dozen conforming blocks
            # either; the maximum can, and one runaway paragraph is exactly what
            # a reader notices first.
            sm, wantsm = pr.get('sentence_words_max', 0), want.get('sentence_words_median', 0)
            if wantsm >= 2 and sm > max(wantsm * 4, wantsm + 15):
                problems.append(('warn', base, 'sentences',
                    f"the longest block runs {sm:.0f} words against a house median of {wantsm:.0f} — "
                    'the file average hides it'))

        if spec.get('named_styles') and d.get('styles') is not None:
            missing = [s for s in ('Heading1', 'Heading2', 'Title')
                       if s in spec['named_styles'] and s not in d['styles']]
            if missing:
                problems.append(('warn', base, 'styles',
                                 f"house styles absent from the file: {', '.join(missing)}"))
    return problems


def summarize(spec):
    g = spec.get('geometry', {})
    lines = [f"house style from {len(spec['from'])} sample(s): {', '.join(filter(None, spec['from']))}", '']
    lines.append(f"  fonts     {', '.join(spec['fonts'][:6]) or '(none found)'}")
    lines.append(f"  palette   {' '.join('#' + c for c in spec['palette'][:10]) or '(none found)'}")
    if spec['sizes_pt']:
        lines.append(f"  sizes     {', '.join(str(s) for s in spec['sizes_pt'][:12])} pt")
    for k, v in g.items():
        lines.append(f"  {k:<9} {v}")
    if spec['layouts']:
        uniq = list(dict.fromkeys(spec['layouts']))
        lines.append(f"  layouts   {', '.join(uniq[:8])}{' …' if len(uniq) > 8 else ''}")
    for unit, b in (spec.get('prose') or {}).items():
        lines.append(f"  prose     {b['words_per_unit']:.0f} words/{unit} · sentence {b['sentence_words_median']:.0f} w "
                     f"(p90 {b['sentence_words_p90']:.0f}) · {b['bullets_per_unit']:.1f} bullets/{unit} · "
                     f"{b['block_ends_with_period']*100:.0f}% end in a full stop · headings {b['heading_words_median']:.0f} w")
    if spec['named_styles']:
        lines.append(f"  styles    {', '.join(spec['named_styles'][:10])}"
                     f"{' …' if len(spec['named_styles']) > 10 else ''}")
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(prog='style.py')
    sub = ap.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('extract'); e.add_argument('files', nargs='+'); e.add_argument('-o', '--out')
    c = sub.add_parser('check'); c.add_argument('files', nargs='+'); c.add_argument('--spec', required=True)
    a = ap.parse_args()

    if a.cmd == 'extract':
        spec = build_spec(a.files)
        if a.out:
            with open(a.out, 'w') as f:
                json.dump(spec, f, indent=2, ensure_ascii=False)
        print('\n' + summarize(spec) + '\n')
        if a.out:
            print(f'  written to {a.out}\n')
        return 0

    with open(a.spec) as f:
        spec = json.load(f)
    problems = check(a.files, spec)
    errs = [p for p in problems if p[0] == 'error']
    print(f'\nstyle check — {len(a.files)} file(s) against {os.path.basename(a.spec)}\n')
    for level, base, kind, msg in problems:
        print(f"  {'x' if level == 'error' else '!'} {base}  [{kind}] {msg}")
    if not problems:
        print('  ok — nothing off-style')
    print('')
    return 2 if errs else (1 if problems else 0)


if __name__ == '__main__':
    sys.exit(main())
