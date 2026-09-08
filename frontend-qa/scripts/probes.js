// In-page probes. Injected as an IIFE by qa-run.mjs; returns a JSON string.
// Everything here is DOM truth at the moment of the call — no heuristics about
// what the page "meant".
(() => {
  const vis = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const where = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const name = el =>
    (el.getAttribute('aria-label') || '').trim() ||
    (el.getAttribute('title') || '').trim() ||
    (el.getAttribute('alt') || '').trim() ||
    (el.getAttribute('aria-labelledby')
      ? (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || '').trim() : '') ||
    (el.textContent || '').trim() ||
    (el.value || '').trim();

  const out = { overflow: [], clipped: [], images: [], controls: [], labels: [], headings: [], targets: [], dupIds: [], deadLinks: [], contrast: [], contrastSkipped: 0, focus: [], canvasApps: [] };

  // 1. Horizontal overflow — the body must never scroll sideways.
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1) out.overflow.push({ el: where(el), right: Math.round(r.right), over: Math.round(r.right - vw), w: Math.round(r.width) });
    }
    // Narrowest offenders first: the leaf that actually overflows is more useful
    // than the six ancestors stretched around it.
    out.overflow.sort((a, b) => a.w - b.w);
    out.overflow = out.overflow.slice(0, 8);
    if (!out.overflow.length) out.overflow.push({ el: '(unidentified)', right: document.documentElement.scrollWidth, over: document.documentElement.scrollWidth - vw, w: 0 });
  }

  // 1b. Content that sticks out of the viewport but produces NO scrollbar.
  // Centred overflow (flex/grid `place-content:center`, `margin:auto`) is clipped
  // on both sides instead of scrollable, so scrollWidth never grows and check 1
  // sees nothing — while the user genuinely cannot reach the content.
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1 || r.left < -1) {
      if (el.querySelector(':scope > *') && [...el.children].some(c => vis(c) && c.getBoundingClientRect().width > vw + 1)) continue;
      out.clipped.push({ el: where(el), w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) });
      if (out.clipped.length > 6) break;
    }
  }

  // 2. Images: broken, and missing alt.
  for (const img of document.images) {
    if (img.complete && img.naturalWidth === 0 && img.currentSrc)
      out.images.push({ el: where(img), issue: 'broken', src: img.currentSrc.slice(0, 120) });
    else if (!img.hasAttribute('alt') && vis(img))
      out.images.push({ el: where(img), issue: 'no alt', src: (img.currentSrc || '').slice(0, 120) });
  }

  // 3. Interactive controls with no accessible name — unusable by screen reader,
  //    and usually also a sign of an icon button nobody labelled.
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type="submit"], input[type="button"]')) {
    if (!vis(el)) continue;
    if (!name(el) && !el.querySelector('img[alt]:not([alt=""]), svg title')) out.controls.push({ el: where(el) });
  }

  // 4. Form fields with no label.
  for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea')) {
    if (!vis(el)) continue;
    const labelled = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
      el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (!labelled) out.labels.push({ el: where(el), type: el.type || el.tagName.toLowerCase(), placeholder: el.placeholder || null });
  }

  // 5. Heading order.
  let prev = 0;
  for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if (!vis(h)) continue;
    const lvl = +h.tagName[1];
    if (prev && lvl > prev + 1) out.headings.push({ el: where(h), from: prev, to: lvl, text: h.textContent.trim().slice(0, 60) });
    prev = lvl;
  }
  const h1 = [...document.querySelectorAll('h1')].filter(vis);
  if (h1.length !== 1) out.headings.push({ el: 'document', h1count: h1.length });

  // 6. Tap targets (only meaningful at mobile widths; the runner filters).
  for (const el of document.querySelectorAll('a[href], button, [role="button"], input[type="checkbox"], input[type="radio"]')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44)
      out.targets.push({ el: where(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 30) });
  }

  // 7. Duplicate DOM ids — breaks label[for], anchors, and querySelector.
  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) out.dupIds.push({ id, count: n });

  // 8. Links that go nowhere.
  for (const a of document.querySelectorAll('a')) {
    if (!vis(a)) continue;
    const href = a.getAttribute('href');
    if (href === null || href === '' || href === '#')
      out.deadLinks.push({ el: where(a), text: (a.textContent || '').trim().slice(0, 40), href });
  }

  // 8b. Colour contrast. The most common real accessibility failure, and one
  // people assume a tool cannot see — it can, whenever the background resolves
  // to a solid colour. Where it does not (an image or a gradient behind the
  // text) the element is counted as unverifiable rather than guessed at.
  const parseRGB = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const [r, g, b, a] = m[1].split(',').map(v => parseFloat(v));
    return { r, g, b, a: a === undefined ? 1 : a };
  };
  const lum = ({ r, g, b }) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const effectiveBg = el => {
    for (let n = el; n && n !== document.documentElement.parentNode; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.backgroundImage && st.backgroundImage !== 'none') return 'image';
      const c = parseRGB(st.backgroundColor);
      if (c && c.a >= 0.95) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const ownText = el => [...el.childNodes]
    .filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');

  for (const el of document.querySelectorAll('body *')) {
    const t = ownText(el);
    if (!t || !vis(el)) continue;
    const st = getComputedStyle(el);
    const fg = parseRGB(st.color);
    if (!fg || fg.a < 0.95) continue;
    const bg = effectiveBg(el);
    if (bg === 'image') { out.contrastSkipped++; continue; }
    const size = parseFloat(st.fontSize) || 16;
    const bold = (parseInt(st.fontWeight, 10) || 400) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3.0 : 4.5;
    const r = ratio(fg, bg);
    if (r < need) {
      out.contrast.push({ el: where(el), ratio: +r.toFixed(2), need,
                          size: Math.round(size), text: t.slice(0, 42) });
      if (out.contrast.length > 12) break;
    }
  }

  // 8c. Focus visibility. A control you can tab to but cannot see focused is
  // unusable by keyboard, and `outline: none` with nothing put back is the
  // single most common way it happens.
  const focusables = [...document.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]')]
    .filter(vis).slice(0, 40);
  const active = document.activeElement;
  for (const el of focusables) {
    const before = getComputedStyle(el);
    const snap = s2 => `${s2.outlineStyle}|${s2.outlineWidth}|${s2.outlineColor}|${s2.boxShadow}|${s2.borderColor}|${s2.backgroundColor}`;
    const b0 = snap(before);
    try { el.focus({ preventScroll: true }); } catch { continue; }
    if (document.activeElement !== el) continue;
    const a1 = snap(getComputedStyle(el));
    if (a1 === b0) out.focus.push({ el: where(el), text: (el.textContent || el.value || '').trim().slice(0, 30) });
    if (out.focus.length > 8) break;
  }
  try { active && active.focus && active.focus({ preventScroll: true }); } catch {}

  // 8d. A <canvas> that IS the application. The control-name and alt-text checks
  // are shaped around DOM widgets and see nothing here; a game or editor drawn
  // into a canvas is invisible to assistive technology and to the keyboard, and
  // a sweep that reports "1 warning" on such a page is close to meaningless.
  for (const c of document.querySelectorAll('canvas')) {
    if (!vis(c)) continue;
    const r = c.getBoundingClientRect();
    // Scale-independent: a canvas that carries the page is the biggest thing on
    // it. A viewport-proportional threshold made the same page pass at 1440 and
    // fail at 390, which is worse than not checking.
    const vh = window.innerHeight || 800;
    const area = r.width * r.height;
    let biggest = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || el === c || el.contains(c)) continue;
      const b2 = el.getBoundingClientRect();
      biggest = Math.max(biggest, b2.width * b2.height);
    }
    const big = area >= biggest * 0.9 && area > 0.06 * vw * vh;
    if (!big) continue;
    const named = c.getAttribute('aria-label') || c.getAttribute('title') ||
                  c.getAttribute('aria-labelledby') || (c.textContent || '').trim();
    const reachable = c.hasAttribute('tabindex') || c.getAttribute('role');
    if (!named || !reachable) {
      out.canvasApps.push({
        el: where(c), w: Math.round(r.width), h: Math.round(r.height),
        named: !!named, reachable: !!reachable,
        controls: document.querySelectorAll('button,[role="button"],a[href],input,select,textarea').length,
      });
    }
  }

  // 9. The viewport meta. Without width=device-width a phone lays the page out
  // at ~980px and scales it down, so the site is unreadable AND every width-based
  // measurement above is taken in a 980px viewport that does not exist on screen.
  const vp = document.querySelector('meta[name="viewport" i]');
  out.viewport = {
    present: !!vp,
    content: vp ? vp.getAttribute('content') : null,
    deviceWidth: !!vp && /width\s*=\s*device-width/i.test(vp.getAttribute('content') || ''),
    layoutWidth: vw,
    screenWidth: window.screen.width,
  };

  out.stats = {
    title: document.title,
    nodes: document.querySelectorAll('*').length,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: vw,
  };
  return JSON.stringify(out);
})()
