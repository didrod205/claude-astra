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
    fonts, colors = Counter(), Counter()
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
    return fonts, colors


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
    f, c = scan_used(z, [r'word/document\.xml', r'word/header\d*\.xml', r'word/footer\d*\.xml'])
    d['fonts_used'] = dict(f.most_common(12))
    d['colors_used'] = dict(c.most_common(16))
    return d


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
    f, c = scan_used(z, [r'ppt/slides/slide\d+\.xml', r'ppt/slideMasters/slideMaster\d+\.xml'])
    d['fonts_used'] = dict(f.most_common(12))
    d['colors_used'] = dict(c.most_common(16))
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
    _, c = scan_used(z, [r'xl/styles\.xml', r'xl/theme/theme\d+\.xml'])
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
    d = {'kind': 'pdf', 'pages': doc.page_count, 'page_in': page_in,
         'fonts_used': dict(fonts.most_common(12)),
         'sizes_pt': [s for s, _ in sizes.most_common(10)],
         'colors_used': dict(colors.most_common(16))}
    # Measured from where text actually sits, so this is the text block's inset,
    # not a declared margin — a short line does not prove a wide right margin.
    if left is not None and page_in:
        d['text_inset_in'] = {'left': round(left / 72, 2)}
    return d


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

    return {
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

        used_fonts = set((d.get('fonts_used') or {}))
        for st in (d.get('styles') or {}).values():
            if st.get('font'):
                used_fonts.add(st['font'])
        off = sorted(f for f in used_fonts if f.lower() not in ok_fonts)
        if off:
            problems.append(('error', base, 'font',
                             f"typefaces not in the house set: {', '.join(off[:6])}"))

        used_colors = set(d.get('colors_used') or {})
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
