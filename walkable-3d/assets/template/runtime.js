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

const D2R = Math.PI / 180;
const EYE = 1.7;          // metres — human eye height. Do not "tune" this.
const RADIUS = 0.35;      // player capsule radius in XZ
const STEP_UP = 0.45;     // max height you can walk up without jumping

/* ---------------------------------------------------------------- geometry */

const GEOM = {
  box: o => new THREE.BoxGeometry(...(o.size ?? [1, 1, 1])),
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

function buildScene(manifest) {
  const scene = new THREE.Scene();
  const env = manifest.environment ?? {};
  const sky = new THREE.Color(env.skyColor ?? '#9fb8d4');
  const ground = new THREE.Color(env.groundColor ?? '#4a4640');

  scene.background = sky;
  if (env.fog) scene.fog = new THREE.Fog(sky, env.fog[0] ?? 5, env.fog[1] ?? 90);

  // Lighting recipe: hemisphere fill + one keyed, shadow-casting sun + a weak
  // rim. Flat, single-ambient scenes are the #1 tell of generated 3D.
  scene.add(new THREE.HemisphereLight(sky, ground, env.ambient ?? 0.55));
  const sun = new THREE.DirectionalLight(0xfff3e0, env.sunIntensity ?? 2.2);
  sun.position.set(...(env.sunPosition ?? [12, 20, 8]));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;   // kills the banded acne on large flat walls
  const s = env.shadowExtent ?? 30;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: s * 4 });
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0xbcd0ff, 0.35);
  rim.position.set(-10, 8, -12);
  scene.add(rim);

  const materials = new Map();
  for (const [name, def] of Object.entries(manifest.materials ?? {})) {
    materials.set(name, buildMaterial(def));
  }
  const matFor = o => {
    if (typeof o.material === 'string') {
      if (!materials.has(o.material)) materials.set(o.material, buildMaterial({ color: '#c0392b' }));
      return materials.get(o.material);
    }
    return buildMaterial(o.material ?? {});
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
    if (o.kind === 'group' || !o.kind) {
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

  return { step, state, pos };
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  const manifest = window.SCENE ?? await fetch('./scene.json').then(r => {
    if (!r.ok) throw new Error(`scene.json: HTTP ${r.status}`);
    return r.json();
  });

  const { scene, solids, byId } = buildScene(manifest);

  const camera = new THREE.PerspectiveCamera(manifest.fov ?? 68, innerWidth / innerHeight, 0.05, 800);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = manifest.environment?.exposure ?? 1.0;
  document.body.appendChild(renderer.domElement);

  const colliders = [];
  scene.traverse(n => { if (n.isMesh) colliders.push(n); });

  const ctrl = makeController(camera, solids, colliders, manifest.spawn);
  ctrl.step(0);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const start = document.getElementById('start');
  const hud = document.getElementById('hud');
  start.addEventListener('click', () => document.body.requestPointerLock());
  document.addEventListener('pointerlockchange', () =>
    start.classList.toggle('hide', document.pointerLockElement === document.body));

  let last = performance.now(), fps = 0, acc = 0, frames = 0, frozen = false;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    acc += dt; frames++;
    if (acc > 0.5) { fps = Math.round(frames / acc); acc = 0; frames = 0; }
    if (!frozen) ctrl.step(dt);
    renderer.render(scene, camera);
    hud.textContent =
      `${fps} fps · ${renderer.info.render.calls} calls · ` +
      `${(renderer.info.render.triangles / 1000).toFixed(0)}k tris\n` +
      `x ${ctrl.pos.x.toFixed(1)}  y ${ctrl.pos.y.toFixed(1)}  z ${ctrl.pos.z.toFixed(1)}`;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---- headless + tooling hooks ---- */

  window.__three = { THREE, scene, camera, renderer, byId, manifest };

  /** Take manual control of the camera: freezes the walk sim and hides the UI
   *  chrome, so a headless capture shows the scene and nothing else. */
  window.__setCamera = ({ position, lookAt }) => {
    frozen = true;
    start.classList.add('hide');
    hud.style.display = 'none';
    if (position) camera.position.set(...position);
    if (lookAt) camera.lookAt(new THREE.Vector3(...lookAt));
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    return { position: camera.position.toArray(), rotation: camera.rotation.toArray().slice(0, 3) };
  };

  window.__thaw = () => { frozen = false; hud.style.display = ''; };

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
    const objs = [];
    scene.traverse(n => {
      if (!n.userData?.__manifest) return;   // skip lights, light targets, helpers
      const box = new THREE.Box3().setFromObject(n);
      const size = box.getSize(new THREE.Vector3());
      objs.push({
        id: n.name || '(unnamed)',
        type: n.isMesh ? (n.userData.kind ?? 'mesh') : 'group',
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
      render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
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
