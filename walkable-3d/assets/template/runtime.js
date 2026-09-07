// Walkable-scene runtime.
// Reads a scene manifest (scene.json, or window.SCENE) and builds a named,
// hierarchical, individually-editable object graph — then lets you walk it.
//
// Headless hooks (used by scripts/shot.mjs and scripts/audit.mjs):
//   window.__ready            -> Promise that resolves when the scene is built
//   window.__three            -> { THREE, scene, camera, renderer }
//   window.__setCamera(pose)  -> { position:[x,y,z], lookAt:[x,y,z] } and renders one frame
//   window.__audit()          -> structural report (see references/verification.md)
//   window.__exportGLTF()     -> Promise<ArrayBuffer> of a .glb

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const D2R = Math.PI / 180;
const EYE = 1.7;          // metres — human eye height. Do not "tune" this.
const RADIUS = 0.35;      // player capsule radius in XZ
const STEP_UP = 0.45;     // max height you can walk up without jumping

/* ---------------------------------------------------------------- geometry */

/* ------------------------------------------------------------------ sky ---
   A gradient sky written to an equirect canvas. It is the background AND, once
   run through PMREM, the scene's environment light — which is what stops PBR
   materials reading as flat paint. A single ambient colour cannot do this.      */

function skyTexture(skyHex, groundHex, sunPos) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const sky = new THREE.Color(skyHex), ground = new THREE.Color(groundHex);
  const zenith = sky.clone().multiplyScalar(0.72);
  const haze = sky.clone().lerp(new THREE.Color('#ffffff'), 0.55);
  const css = c3 => `rgb(${(c3.r * 255) | 0},${(c3.g * 255) | 0},${(c3.b * 255) | 0})`;

  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.00, css(zenith));
  grad.addColorStop(0.34, css(sky));
  grad.addColorStop(0.49, css(haze));
  grad.addColorStop(0.51, css(ground.clone().lerp(haze, 0.45)));
  grad.addColorStop(1.00, css(ground.clone().multiplyScalar(0.75)));
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);

  const [sx3, sy3, sz3] = sunPos;
  const len = Math.hypot(sx3, sy3, sz3) || 1;
  const az = Math.atan2(sx3, sz3), el = Math.asin(sy3 / len);
  const sx = (0.5 - az / (Math.PI * 2)) * 1024;
  const sy = (0.5 - el / Math.PI) * 512;
  g.globalCompositeOperation = 'lighter';
  for (const [r, a] of [[240, 0.30], [110, 0.42], [34, 1.0]]) {
    const rg = g.createRadialGradient(sx, sy, 0, sx, sy, r);
    rg.addColorStop(0, `rgba(255,247,228,${a})`);
    rg.addColorStop(1, 'rgba(255,240,205,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 1024, 512);
  }
  g.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* --------------------------------------------------------- rounded boxes ---
   A perfectly sharp edge is the loudest tell of untouched CAD. Every real edge
   has a small radius that catches a highlight; 1-2 cm is invisible as geometry
   and unmistakable as light.                                                    */

function roundedBox(w, h, d, r) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  if (!(r > 0.0015)) return new THREE.BoxGeometry(w, h, d);
  const shape = new THREE.Shape();
  const x = w / 2 - r, y = h / 2 - r;
  shape.moveTo(-x, -h / 2);
  shape.lineTo(x, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -y);
  shape.lineTo(w / 2, y);
  shape.quadraticCurveTo(w / 2, h / 2, x, h / 2);
  shape.lineTo(-x, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y);
  shape.lineTo(-w / 2, -y);
  shape.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(d - 2 * r, 1e-4), bevelEnabled: true,
    bevelSize: r, bevelThickness: r, bevelSegments: 2, curveSegments: 2,
  });
  geo.translate(0, 0, -(d / 2 - r));
  geo.computeVertexNormals();
  return geo;
}

const GEOM = {
  box: o => roundedBox(...(o.size ?? [1, 1, 1]),
                       o.bevel ?? Math.min(0.018, Math.min(...(o.size ?? [1, 1, 1])) * 0.14)),
  plane: o => new THREE.PlaneGeometry(...(o.size ?? [1, 1])),
  sphere: o => new THREE.SphereGeometry(o.radius ?? 0.5, o.segments ?? 24, (o.segments ?? 24) >> 1),
  cylinder: o => new THREE.CylinderGeometry(
    o.radiusTop ?? o.radius ?? 0.5, o.radiusBottom ?? o.radius ?? 0.5,
    o.height ?? 1, o.segments ?? 24),
  cone: o => new THREE.ConeGeometry(o.radius ?? 0.5, o.height ?? 1, o.segments ?? 24),
  torus: o => new THREE.TorusGeometry(o.radius ?? 0.5, o.tube ?? 0.15, 16, o.segments ?? 32),
};

function buildMaterial(def = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(def.color ?? '#b9b9b9'),
    roughness: def.roughness ?? 0.85,
    metalness: def.metalness ?? 0.0,
    transparent: def.opacity != null && def.opacity < 1,
    opacity: def.opacity ?? 1,
    side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (def.emissive) {
    m.emissive = new THREE.Color(def.emissive);
    m.emissiveIntensity = def.emissiveIntensity ?? 1;
  }
  return m;
}

/* ------------------------------------------------------------------- build */

function buildScene(manifest, renderer) {
  const scene = new THREE.Scene();
  const env = manifest.environment ?? {};
  const sky = new THREE.Color(env.skyColor ?? '#9fb8d4');
  const ground = new THREE.Color(env.groundColor ?? '#4a4640');
  const sunPos = env.sunPosition ?? [12, 20, 8];

  // Sky as background AND as image-based lighting. The IBL is what gives every
  // surface a direction-dependent response instead of one flat shade.
  const skyTex = skyTexture(sky, ground, sunPos);
  scene.background = skyTex;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromEquirectangular(skyTex).texture;
  // Keep the IBL as fill, not as the key light — push it much past ~0.6 and it
  // washes the albedo out until every surface reads as the same pale grey.
  scene.environmentIntensity = env.envIntensity ?? 0.5;

  if (env.fog) {
    const horizon = sky.clone().lerp(new THREE.Color('#ffffff'), 0.5);
    scene.fog = new THREE.Fog(horizon, env.fog[0] ?? 5, env.fog[1] ?? 90);
  }

  // One keyed, shadow-casting sun over the IBL, plus a cool bounce from below
  // the horizon. A single ambient light is the #1 tell of generated 3D.
  const sun = new THREE.DirectionalLight(0xfff2dd, env.sunIntensity ?? 2.0);
  sun.position.set(...sunPos);
  sun.castShadow = true;
  const sm = env.shadowMap ?? 4096;
  sun.shadow.mapSize.set(sm, sm);
  sun.shadow.bias = env.shadowBias ?? -0.0016;
  // normalBias must stay well under the thinnest wall in the scene: it offsets
  // the sample along the normal, and 8 cm on a 16 cm wall pushes it out the
  // other side, which reads as a jagged band rather than as the acne it fixes.
  sun.shadow.normalBias = env.normalBias ?? 0.035;
  sun.shadow.radius = 1.0;
  const s = env.shadowExtent ?? 30;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: s * 4 });
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(sky, ground, env.ambient != null ? env.ambient * 0.45 : 0.28));

  const materials = new Map();
  for (const [name, def] of Object.entries(manifest.materials ?? {})) {
    materials.set(name, buildMaterial(def));
  }
  // A tiny per-object shade variation. Twenty identical flat surfaces is the
  // second-loudest tell after sharp edges; ±4% is invisible as a decision and
  // obvious as an absence.
  let jseed = 0x9e3779b9;
  const jitter = () => { jseed = (Math.imul(jseed, 1664525) + 1013904223) | 0; return ((jseed >>> 0) / 4294967296 - 0.5); };
  const varied = new Map();
  const matFor = o => {
    let base;
    if (typeof o.material === 'string') {
      if (!materials.has(o.material)) materials.set(o.material, buildMaterial({ color: '#c0392b' }));
      base = materials.get(o.material);
    } else base = buildMaterial(o.material ?? {});
    if (o.vary === false || manifest.vary === false) return base;
    const key = `${o.id}`;
    if (!varied.has(key)) {
      const m = base.clone();
      const hsl = {}; m.color.getHSL(hsl);
      m.color.setHSL(hsl.h, THREE.MathUtils.clamp(hsl.s * (1 + jitter() * 0.10), 0, 1),
                            THREE.MathUtils.clamp(hsl.l * (1 + jitter() * 0.09), 0, 1));
      m.roughness = THREE.MathUtils.clamp(m.roughness + jitter() * 0.08, 0.04, 1);
      varied.set(key, m);
    }
    return varied.get(key);
  };

  const byId = new Map();
  const solids = [];
  const collect = [];

  const flatten = (list, parentId) => {
    for (const o of list ?? []) {
      collect.push({ ...o, parent: o.parent ?? parentId });
      if (o.children) flatten(o.children, o.id);
    }
  };
  flatten(manifest.objects);

  const makeLight = o => {
    const col = new THREE.Color(o.color ?? '#ffffff');
    const inten = o.intensity ?? 8;
    let l;
    if (o.light === 'spot') {
      l = new THREE.SpotLight(col, inten, o.distance ?? 0, (o.angle ?? 40) * D2R, o.penumbra ?? 0.4, o.decay ?? 2);
    } else if (o.light === 'rect' || o.light === 'area') {
      l = new THREE.PointLight(col, inten, o.distance ?? 0, o.decay ?? 2);   // RectAreaLight needs extra deps
    } else {
      l = new THREE.PointLight(col, inten, o.distance ?? 0, o.decay ?? 2);
    }
    if (o.castShadow) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.bias = -0.002;
      l.shadow.normalBias = 0.02;
    }
    return l;
  };

  for (const o of collect) {
    if (!o.id) { console.warn('[scene] object without id, skipped', o); continue; }
    // A duplicate id used to silently drop the second object. Keep both, rename
    // the later one, and shout — a missing object is worse than a bad name.
    let id = o.id;
    if (byId.has(id)) {
      let n = 2; while (byId.has(`${id}__dup${n}`)) n++;
      console.error(`[scene] duplicate id "${id}" — renamed to "${id}__dup${n}"`);
      id = `${id}__dup${n}`;
    }

    let node;
    if (o.kind === 'light') {
      node = makeLight(o);
    } else if (o.kind === 'group' || !o.kind) {
      node = new THREE.Group();
    } else if (GEOM[o.kind]) {
      node = new THREE.Mesh(GEOM[o.kind](o), matFor(o));
      node.castShadow = o.castShadow ?? true;
      node.receiveShadow = o.receiveShadow ?? true;
    } else {
      console.warn('[scene] unknown kind:', o.kind, 'on', o.id);
      node = new THREE.Group();
    }

    node.name = id;
    node.userData = { ...(o.userData ?? {}), solid: !!o.solid, kind: o.kind ?? 'group', tag: o.tag ?? null, __manifest: true };
    if (o.position) node.position.set(...o.position);
    if (o.rotation) node.rotation.set(o.rotation[0] * D2R, o.rotation[1] * D2R, o.rotation[2] * D2R);
    if (o.scale != null) {
      Array.isArray(o.scale) ? node.scale.set(...o.scale) : node.scale.setScalar(o.scale);
    }
    if (o.visible === false) node.visible = false;

    byId.set(id, node);
    o.__id = id;
  }

  for (const o of collect) {
    const node = byId.get(o.__id ?? o.id);
    if (!node) continue;
    const parent = o.parent ? byId.get(o.parent) : null;
    (parent ?? scene).add(node);
    if (o.parent && !parent) console.warn('[scene] missing parent', o.parent, 'for', o.id);
  }

  scene.updateMatrixWorld(true);
  scene.traverse(n => { if (n.userData?.solid) solids.push(new THREE.Box3().setFromObject(n)); });

  // Fit the shadow camera to what was actually built, ignoring terrain-sized
  // slabs. A hand-set extent is nearly always far too generous, and every
  // wasted metre costs shadow-map resolution where the geometry actually is.
  if (env.shadowExtent == null) {
    const full = new THREE.Box3().setFromObject(scene);
    const area = Math.max((full.max.x - full.min.x) * (full.max.z - full.min.z), 1e-6);
    const acc = new THREE.Box3(); let kept = 0;
    scene.traverse(n => {
      if (!n.isMesh || !n.userData?.__manifest) return;
      const b = new THREE.Box3().setFromObject(n);
      if (((b.max.x - b.min.x) * (b.max.z - b.min.z)) / area > 0.45) return;
      acc.union(b); kept++;
    });
    if (kept) {
      const c = acc.getCenter(new THREE.Vector3());
      const half = Math.max(acc.max.x - acc.min.x, acc.max.z - acc.min.z) * 0.62 + 2;
      Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: half * 6 });
      sun.target.position.copy(c);
      sun.position.set(c.x + sunPos[0], c.y + sunPos[1], c.z + sunPos[2]);
      sun.target.updateMatrixWorld();
      sun.shadow.camera.updateProjectionMatrix();
    }
  }

  return { scene, sun, solids, byId };
}

/* ---------------------------------------------------------------- controls */

function makeController(camera, solids, colliders, spawn) {
  const state = { yaw: 0, pitch: 0, vy: 0, onGround: false, keys: new Set() };
  const pos = new THREE.Vector3(...(spawn?.position ?? [0, EYE, 4]));

  if (spawn?.lookAt) {
    const d = new THREE.Vector3(...spawn.lookAt).sub(pos);
    state.yaw = Math.atan2(-d.x, -d.z);
    state.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  const overlaps = (x, z) => solids.some(b =>
    x + RADIUS > b.min.x && x - RADIUS < b.max.x &&
    z + RADIUS > b.min.z && z - RADIUS < b.max.z &&
    pos.y - EYE + 1.6 > b.min.y && pos.y - EYE + 0.1 < b.max.y);

  const ray = new THREE.Raycaster();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const floorAt = (x, z, fromY) => {
    ray.set(new THREE.Vector3(x, fromY, z), DOWN);
    ray.far = 60;
    const hit = ray.intersectObjects(colliders, false)[0];
    return hit ? hit.point.y : null;
  };

  addEventListener('keydown', e => {
    state.keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', e => state.keys.delete(e.code));
  addEventListener('mousemove', e => {
    if (document.pointerLockElement !== document.body) return;
    state.yaw -= e.movementX * 0.0022;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - e.movementY * 0.0022));
  });

  function step(dt) {
    const k = state.keys;
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 5.6 : 2.6);
    let fx = 0, fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
    const dx = ((fx / len) * cos - (fz / len) * sin) * speed * dt;
    const dz = ((fx / len) * sin + (fz / len) * cos) * speed * dt;

    if (!overlaps(pos.x + dx, pos.z)) pos.x += dx;   // slide along walls: resolve
    if (!overlaps(pos.x, pos.z + dz)) pos.z += dz;   // each axis independently

    state.vy -= 22 * dt;
    if (state.onGround && k.has('Space')) { state.vy = 7.0; state.onGround = false; }
    pos.y += state.vy * dt;

    const ground = floorAt(pos.x, pos.z, pos.y + 2);
    if (ground != null) {
      const target = ground + EYE;
      if (pos.y <= target + 0.01 || (state.onGround && target - pos.y < STEP_UP)) {
        pos.y = target; state.vy = 0; state.onGround = true;
      } else state.onGround = false;
    }
    if (pos.y < -50) { pos.set(...(spawn?.position ?? [0, EYE, 4])); state.vy = 0; }

    camera.position.copy(pos);
    camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
  }

  return { step, state, pos, floorAt, overlaps };
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const manifest = window.SCENE ?? await fetch('./scene.json').then(r => {
    if (!r.ok) throw new Error(`scene.json: HTTP ${r.status}`);
    return r.json();
  });

  const camera = new THREE.PerspectiveCamera(manifest.fov ?? 68, innerWidth / innerHeight, 0.05, 800);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = manifest.environment?.exposure ?? 0.95;
  document.body.appendChild(renderer.domElement);

  const { scene, solids, byId } = buildScene(manifest, renderer);

  // Ambient occlusion. Contact darkening where surfaces meet is the single
  // strongest cue that objects are IN a scene rather than pasted onto it —
  // without it, everything floats no matter how correct the geometry is.
  let composer = null;
  const aoOn = (manifest.environment?.ao ?? true);
  if (aoOn) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = manifest.environment?.aoIntensity ?? 1.0;
      gtao.updateGtaoMaterial({
        // Radius is in METRES. The library default (~0.25) is tuned for props;
        // at room and building scale it produces nothing you can see.
        radius: manifest.environment?.aoRadius ?? 1.5,
        distanceExponent: 1.0, thickness: 1.0,
        scale: manifest.environment?.aoScale ?? 1.6,
        samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false,
      });
      composer.addPass(gtao);
      composer.addPass(new OutputPass());
      window.__ao = gtao;
    } catch (e) {
      console.warn('[scene] ambient occlusion unavailable, falling back to direct render:', e.message);
      composer = null;
    }
  }
  const present = () => (composer ? composer.render() : renderer.render(scene, camera));

  const colliders = [];
  scene.traverse(n => { if (n.isMesh) colliders.push(n); });

  const ctrl = makeController(camera, solids, colliders, manifest.spawn);
  ctrl.step(0);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer?.setSize(innerWidth, innerHeight);
  });

  const start = document.getElementById('start');
  const hud = document.getElementById('hud');
  start.addEventListener('click', () => document.body.requestPointerLock());
  document.addEventListener('pointerlockchange', () =>
    start.classList.toggle('hide', document.pointerLockElement === document.body));

  let last = performance.now(), fps = 0, acc = 0, frames = 0, frozen = false;
  function loop(now) {
    // Clamp to [0, 0.05]. rAF's timestamp is the frame's start time and can be
    // EARLIER than the performance.now() we seeded `last` with, which makes the
    // first dt negative — gravity then adds upward velocity and the player is
    // flung out of the world before the first frame is drawn.
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05); last = now;
    acc += dt; frames++;
    if (acc > 0.5) { fps = Math.round(frames / acc); acc = 0; frames = 0; }
    if (!frozen) ctrl.step(dt);
    present();
    hud.textContent =
      `${fps} fps · ${renderer.info.render.calls} calls · ` +
      `${(renderer.info.render.triangles / 1000).toFixed(0)}k tris\n` +
      `x ${ctrl.pos.x.toFixed(1)}  y ${ctrl.pos.y.toFixed(1)}  z ${ctrl.pos.z.toFixed(1)}`;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---- headless + tooling hooks ---- */

  window.__three = { THREE, scene, camera, renderer, byId, manifest, ctrl };

  /** Take manual control of the camera: freezes the walk sim and hides the UI
   *  chrome, so a headless capture shows the scene and nothing else. */
  window.__setCamera = ({ position, lookAt }) => {
    frozen = true;
    start.classList.add('hide');
    hud.style.display = 'none';
    if (position) camera.position.set(...position);
    if (lookAt) camera.lookAt(new THREE.Vector3(...lookAt));
    camera.updateMatrixWorld(true);
    present();
    return { position: camera.position.toArray(), rotation: camera.rotation.toArray().slice(0, 3) };
  };

  window.__thaw = () => { frozen = false; hud.style.display = ''; };

  /** Advance the walk simulation by `sec` of fixed steps, with no dependence on
   *  requestAnimationFrame — which a headless or hidden page throttles or pauses
   *  outright. This is how a checker asks "does the ground hold the player up?"
   *  and gets the same answer every time. */
  window.__simulate = (sec = 1, dt = 1 / 60) => {
    const n = Math.max(1, Math.round(sec / dt));
    for (let i = 0; i < n; i++) ctrl.step(dt);
    return { y: ctrl.pos.y, vy: ctrl.state.vy, onGround: ctrl.state.onGround,
             x: ctrl.pos.x, z: ctrl.pos.z, steps: n };
  };

  /** Hide everything sitting entirely above `y`, so a top-down shot cuts through
   *  the building instead of photographing its roof. The single most useful
   *  view of any enclosed interior. __clipReset() puts it back. */
  window.__clipAbove = (y) => {
    let hidden = 0;
    scene.traverse(n => {
      if (!n.isMesh || !n.userData?.__manifest) return;
      if (n.userData.__clipOrig === undefined) n.userData.__clipOrig = n.visible;
      const hide = new THREE.Box3().setFromObject(n).min.y >= y;
      n.visible = hide ? false : n.userData.__clipOrig;
      if (hide) hidden++;
    });
    present();
    return hidden;
  };

  window.__clipReset = () => {
    scene.traverse(n => {
      if (n.userData?.__clipOrig !== undefined) n.visible = n.userData.__clipOrig;
    });
    present();
  };

  const boxOf = b => ({
    min: b.min.toArray(), max: b.max.toArray(),
    size: b.getSize(new THREE.Vector3()).toArray(),
    center: b.getCenter(new THREE.Vector3()).toArray(),
  });

  /** bounds() is the whole scene; bounds({subject:true}) drops terrain-sized
   *  slabs (a ground plane covering most of the footprint), so auto-framing
   *  looks at the buildings and not at 3600 m2 of grass. */
  window.__bounds = ({ subject = false } = {}) => {
    const full = new THREE.Box3().setFromObject(scene);
    if (!subject) return boxOf(full);
    const fullArea = Math.max((full.max.x - full.min.x) * (full.max.z - full.min.z), 1e-6);
    const acc = new THREE.Box3();
    let kept = 0;
    scene.traverse(n => {
      if (!n.isMesh || !n.userData?.__manifest) return;
      const b = new THREE.Box3().setFromObject(n);
      if (((b.max.x - b.min.x) * (b.max.z - b.min.z)) / fullArea > 0.45) return;  // terrain
      acc.union(b); kept++;
    });
    return kept ? boxOf(acc) : boxOf(full);
  };

  window.__exportGLTF = () => new Promise((res, rej) =>
    new GLTFExporter().parse(scene, res, rej, { binary: true, onlyVisible: false }));

  addEventListener('keydown', async e => {
    if (e.code !== 'KeyG' || document.pointerLockElement) return;
    const buf = await window.__exportGLTF();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    a.download = `${manifest.meta?.name ?? 'scene'}.glb`;
    a.click();
  });

  window.__auditData = () => {
    // Measure with a direct scene render: with a post-processing chain,
    // renderer.info reports the last full-screen pass, not the scene.
    renderer.setRenderTarget(null);   // the composer leaves one bound; measuring
    renderer.info.reset();            // into it reports the pass, not the scene
    renderer.render(scene, camera);
    const stats = { ...renderer.info.render, ...{ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } };
    const objs = [];
    scene.traverse(n => {
      if (!n.userData?.__manifest) return;   // skip lights, light targets, helpers
      const box = new THREE.Box3().setFromObject(n);
      const size = box.getSize(new THREE.Vector3());
      objs.push({
        id: n.name || '(unnamed)',
        type: n.isLight ? 'light' : n.isMesh ? (n.userData.kind ?? 'mesh') : 'group',
        parent: n.parent === scene ? null : (n.parent?.name || null),
        solid: !!n.userData.solid,
        visible: n.visible,
        min: box.min.toArray().map(v => +v.toFixed(3)),
        max: box.max.toArray().map(v => +v.toFixed(3)),
        size: size.toArray().map(v => +v.toFixed(3)),
        empty: !isFinite(size.x) || size.length() === 0,
      });
    });
    return {
      objects: objs,
      bounds: window.__bounds(),
      spawn: manifest.spawn ?? null,
      render: { calls: stats.calls, triangles: stats.triangles, geometries: stats.geometries, textures: stats.textures },
    };
  };

  window.__built = true;
}

window.__ready = boot().catch(err => {
  window.__bootError = String(err?.stack ?? err);
  document.getElementById('start').innerHTML =
    `<strong style="color:#ff6b6b">Scene failed to build</strong><small>${String(err)}</small>`;
  throw err;
});
