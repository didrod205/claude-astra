---
name: walkable-3d
description: >-
  Build a real, walkable 3D scene from a prompt, a photo, a floor plan, or a 2D
  sketch — as a self-contained Three.js page you can walk with WASD, then export
  to .glb with every object still named and separable for Blender or Unreal.
  Use whenever someone asks for a 3D scene, a 3D model of a place, a house or
  room or city block or level you can walk around in, "make this photo into 3D",
  "turn this sketch into a Blender model", a first-person walkthrough, a game
  greybox or blockout, or an environment they intend to keep editing —
  "3D로 만들어줘", "걸어다닐 수 있게", "이 사진으로 3D 씬", "블렌더로 열 수 있게".
  The point of the skill is the verification loop: generated 3D almost always
  renders something, and that something is almost always floating, hollow,
  intersecting, or wrong-scaled in ways a single screenshot hides. NOT for 2D
  charts or diagrams, CSS 3D transforms, or driving Blender's GUI by hand.
---

# Walkable 3D

## What you are actually producing

A directory with three files:

```
scene/
  index.html    ← unchanged shell (importmap + canvas)
  runtime.js    ← unchanged engine (builder, lighting, walk controls, hooks)
  scene.json    ← THE DELIVERABLE. This is what you author.
```

Copy `assets/template/` and then **only write `scene.json`.** Everything that
makes the result good — named objects, real-world scale, collision, an export
that opens cleanly in Blender — falls out of the manifest being right. Editing
`runtime.js` per-scene is almost always a mistake; if a scene genuinely needs a
new primitive or behaviour, add it to `runtime.js` as a *general* capability.

## Why a manifest instead of just writing Three.js code

Imperative scene code produces one anonymous blob. A manifest produces a named,
parented, individually addressable object graph — which is what survives glTF
export and lets a person open the result in Blender and move the chair. A scene
of 3,000 separable objects and a scene of 3,000 triangles welded into one mesh
look identical in a screenshot and are worlds apart in usefulness.

It also means iteration is a JSON edit, not a code rewrite. When the user says
"the table's too close to the bed", you change two numbers.

## The loop

```
1. Read the brief. If it's an image, extract structure before geometry
   (rooms, openings, storeys, what the eye-level path through it is).
2. Lay out on paper first — a metre grid, room by room. references/scale.md
3. Write scene.json.
4. node scripts/audit.mjs <dir>          ← structural truth. Fix every error.
4b. node scripts/walk.mjs <dir>          ← can you actually MOVE through it?
5. node scripts/shot.mjs <dir> --out shots --plan <y per storey>
                                            ← 6 angles + a cutaway plan. Read ALL.
6. Fix what the images show. Back to 4.
7. node scripts/export-glb.mjs <dir>     ← only when 4 and 5 are clean.
```

**Do not skip step 5, and do not look at only one image.** The signature failure
of generated 3D is a scene that is correct from the front and hollow, floating,
or missing from every other side. `shot.mjs` takes spawn + four orbit angles +
top-down for exactly this reason.

**If the scene has an interior, add `--plan`.** A roofed building is opaque from
all six default angles — they will show you four elevations and a roof while the
stairs, the furniture and the room layout go unexamined. One cut per storey, just
under its ceiling: `--plan 2.6 --plan 5.4`.

## Non-negotiables

**1 unit = 1 metre. Always.** Eye height 1.7. Door 0.9 × 2.05. Ceiling 2.4–2.7.
Desk 0.75. Every "why does this feel like a dollhouse / a cathedral" complaint
traces back to abandoning this. Full table in `references/scale.md`.

**Rotations in `scene.json` are degrees**, converted internally. Don't write radians.

**`solid: true` is what you collide with.** Walls, furniture, trunks. Floors,
ground, rugs, stairs must be **`solid: false`** — the walk controller finds
floors by raycasting down, and a solid floor becomes a wall you cannot enter.
This is the single most common mistake in a first draft.

**Standing is not walking.** `audit.mjs` proves the ground holds the player up
where they spawn. `walk.mjs` holds W in eight directions and reports how far they
got, how much they climbed, and whether they ever ended up below the ground. It
is the only check that catches a scene which looks right, audits clean, and
cannot be entered through its own front door — which is exactly what the bundled
cabin did until the door leaf was opened past the width of a person.

**The spawn point is part of the design.** Put it where the scene reads best on
arrival, outside a solid, with floor under it. `audit.mjs` fails the build if the
player would start trapped inside a wall or fall out of the world.

**Leave the lighting recipe alone.** `runtime.js` ships hemisphere fill + a keyed
shadow-casting sun + a cool rim. A single ambient light is the most recognisable
tell of generated 3D. Tune `environment` values in the manifest instead.

## Reading the audit

`audit.mjs` exits 2 on errors, 1 on warnings, 0 clean. Errors mean the scene is
broken, not ugly. See `references/verification.md` for what each check means and
the usual cause. The ones worth memorising:

| check | what it caught |
|---|---|
| `layout` — n/m meshes centred on origin | you wrote objects without positions; they are stacked inside each other |
| `spawn` — inside solid / no surface under | not walkable, whatever the screenshots show |
| `clash` — solids overlapping >25% | furniture inside walls |
| `empty` / `degenerate` | a `kind` typo silently produced an empty group |

## From here into Blender / Unreal / a game

`export-glb.mjs` writes a `.glb` that keeps names and parenting. Blender:
*File → Import → glTF 2.0*. Unreal 5: drag the `.glb` into the Content Browser.
Details, and what to do when the mesh topology isn't good enough for the target
use, in `references/export.md`.

## Files

- `assets/template/` — copy this whole directory to start a scene
- `references/manifest.md` — the full `scene.json` schema, every field
- `references/scale.md` — real-world dimensions, layout method, lighting presets
- `references/verification.md` — every audit check, how to read the shots
- `references/export.md` — glTF out, Blender/Unreal import, Blender `bpy` path
- `scripts/audit.mjs`, `walk.mjs`, `shot.mjs`, `serve.mjs`, `export-glb.mjs`, `lib.mjs`

Scripts are zero-dependency Node (22+) driving headless Chrome over CDP. They
find Chrome themselves; set `CHROME_BIN` to override, `W3D_GL=angle` to use the
real GPU instead of the default software renderer.
