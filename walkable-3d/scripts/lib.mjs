// Zero-dependency helpers: static file server, headless Chrome launcher, CDP client.
// Node 22+ (global WebSocket, global fetch).

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.hdr': 'image/vnd.radiance',
  '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream',
};

export function serve(root, port = 0) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(base, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () =>
    ok({ port: server.address().port, close: () => server.close() })));
}

const CHROME_PATHS = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

async function findChrome() {
  const { access } = await import('node:fs/promises');
  for (const p of CHROME_PATHS) { try { await access(p); return p; } catch {} }
  throw new Error('Chrome not found. Set CHROME_BIN to a Chrome/Chromium binary.');
}

export async function launchChrome({ headless = true, port = 9333 } = {}) {
  const bin = await findChrome();
  const dir = await mkdtemp(join(tmpdir(), 'w3d-'));
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--mute-audio', '--hide-scrollbars',
    // Software WebGL: the only configuration that renders reliably in headless
    // on every machine. Set W3D_GL=angle for GPU-backed rendering when you have one.
    ...(process.env.W3D_GL === 'angle' ? ['--use-angle=default', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });

  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { proc, port, kill: () => { try { proc.kill('SIGKILL'); } catch {} } };
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill('SIGKILL');
  throw new Error(`Chrome did not open a debug port.\n${stderr.slice(-800)}`);
}

export class CDP {
  #ws; #id = 0; #pending = new Map(); #handlers = new Map();

  static async page(port, url = 'about:blank') {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const target = await r.json();
    const cdp = new CDP();
    await cdp.connect(target.webSocketDebuggerUrl);
    return cdp;
  }

  connect(wsUrl) {
    return new Promise((ok, bad) => {
      this.#ws = new WebSocket(wsUrl);
      this.#ws.onopen = () => ok(this);
      this.#ws.onerror = e => bad(new Error(`CDP socket failed: ${e?.message ?? e}`));
      this.#ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id != null) {
          const p = this.#pending.get(msg.id); this.#pending.delete(msg.id);
          if (!p) return;
          msg.error ? p.bad(new Error(`${msg.error.message} (${p.method})`)) : p.ok(msg.result);
        } else {
          for (const fn of this.#handlers.get(msg.method) ?? []) fn(msg.params);
        }
      };
    });
  }

  on(method, fn) {
    if (!this.#handlers.has(method)) this.#handlers.set(method, []);
    this.#handlers.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, bad) => this.#pending.set(id, { ok, bad, method }));
  }

  /** Evaluate an expression in the page; throws on page-side exceptions. */
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error(`page error: ${e.exception?.description ?? e.text}`);
    }
    return r.result.value;
  }

  close() { try { this.#ws.close(); } catch {} }
}

/** Attach console + pageerror + failed-request collectors. Returns the arrays. */
export async function instrument(cdp) {
  const console_ = [], errors = [], failed = [];
  cdp.on('Runtime.consoleAPICalled', p => {
    const text = p.args.map(a => a.value ?? a.description ?? a.type).join(' ');
    console_.push({ level: p.type, text });
    if (p.type === 'error') errors.push({ source: 'console', text });
  });
  cdp.on('Runtime.exceptionThrown', p =>
    errors.push({ source: 'exception', text: p.exceptionDetails.exception?.description ?? p.exceptionDetails.text }));
  cdp.on('Network.loadingFailed', p => failed.push({ text: p.errorText, type: p.type }));
  cdp.on('Network.responseReceived', p => {
    if (p.response.status >= 400) failed.push({ text: `HTTP ${p.response.status}`, url: p.response.url });
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  return { console: console_, errors, failed };
}

/** Navigate and wait for load + a settle delay. */
export async function goto(cdp, url, { settle = 400 } = {}) {
  const loaded = new Promise(ok => cdp.on('Page.loadEventFired', ok));
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))]);
  await new Promise(r => setTimeout(r, settle));
}
