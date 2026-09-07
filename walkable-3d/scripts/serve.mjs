#!/usr/bin/env node
// Serve a scene directory so a human can actually walk it.
//   node scripts/serve.mjs <sceneDir> [--port 5173] [--open]
import { spawn } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { serve } from './lib.mjs';

const argv = process.argv.slice(2);
const dir = resolve(argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--port') ?? '.');
const pi = argv.indexOf('--port');
const { port } = await serve(dir, pi < 0 ? 5173 : +argv[pi + 1]);
const url = `http://127.0.0.1:${port}/index.html`;
console.log(`\n  ${basename(dir)} -> ${url}\n  click the page to lock the pointer, WASD to walk, G to export .glb\n`);
if (argv.includes('--open')) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
