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

  const out = { overflow: [], images: [], controls: [], labels: [], headings: [], targets: [], dupIds: [], deadLinks: [] };

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

  out.stats = {
    title: document.title,
    nodes: document.querySelectorAll('*').length,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: vw,
  };
  return JSON.stringify(out);
})()
