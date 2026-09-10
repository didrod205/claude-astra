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

## Before you write scene.json

Quality is decided here, not in the fixing afterwards. Everything below costs a
few objects and is the difference between a greybox and something worth walking
around. The audit now catches the last three, but it is faster to not make them.

**Ground.** `kind: "terrain"` with a `flatten` disc where you build, not a flat
slab. `falloff` at least the amplitude, or you cut a cookie-cutter mesa. To place
anything *outside* the flattened disc, ask `scripts/ground.mjs` for the height —
the terrain is generated in the page and you cannot work it out from the manifest.

**Keep distant scenery out.** A ring of mountain-peak props at 80 m stretches the
subject bounds to 300 m, and every auto-framed shot then photographs empty
landscape. Let the terrain make the distance.

**Every interior needs a `{ kind: "light" }`.** An emissive material is a bright
surface that emits nothing; a room without a light object renders as a black box.

**Where two planes meet, put something.** Skirting at the wall/floor line, a
plinth course around the base outside, corner boards at the corners. The
junction of two flat surfaces has nothing to catch a shadow, and that — not
texture — is why a render reads as a box.

**Openings are six objects, not a hole.** Two wall segments, a lintel, a sill, a
reveal and a glass pane. And a door leaf, opened past 90°: a leaf ajar at 26°
leaves 12 cm of a 1 m opening, which is plenty to look at and impossible to walk
through.

**Trim is not solid.** A 26 cm plinth or step marked `solid` is a fence around
your building. Under 35 cm, leave `solid` off and let the step-up handle it.

**Soft furnishing is layered.** A bed is a headboard, a frame, a mattress, a
duvet that overhangs, a fold, and two pillows — not three coloured slabs.

**Two lights of different colours.** A warm lamp and a cool window give every
surface two things to be shaded by. One source of one colour looks like a render.

**Six to ten materials.** Two neutrals, one or two woods, one cool, one accent.
No detail maps — a shared noise texture reads as burlap on everything and costs
13 MB in the export.

`references/scale.md` has the numbers behind each of these.

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
| `light` | walls but no light object — the interior will be black |
| `passage` | a gap under 0.7 m between two wall-like slabs — nobody fits through |
| `solid` | low solid trim, which is a fence you cannot step over |

## Can a person get to it?

The audit proves the spawn point is not inside a wall. It says nothing about
whether the building has a way in, whether a room is sealed behind a doorway too
narrow to walk through, or whether half of what you modelled is somewhere nobody
can stand. **A scene can audit clean, photograph well, and still be a diorama.**

```bash
node scripts/reach.mjs my-scene
```

It floods the space from spawn, walking every edge with the real controller — so
a step a person could not take is not an edge — and then reports which named
objects at floor level are within reach of somewhere you can stand.

```
  2397 standing places · 2397 m² · 71.5 x 69.2 m of ground
  92 of 92 named objects at floor level are within 2 m of somewhere you can stand
  (20 more sit above head height — roofs, ceilings, lights).

  Nothing modelled at floor level is somewhere a person cannot get to.
```

Swing the cabin's front door shut across its opening and the audit still passes
clean, while this reports eleven things out of reach — the table, the chairs, the
lamp, every stick of furniture in the room:

```
  81 of 92 named objects at floor level are within 2 m of somewhere you can stand

  at floor level and out of reach:
      2.71 m away   leg_3
      2.13 m away   table_top
      ...
```

Exit 0 clean · 1 something at floor level is out of reach · 2 nowhere to stand at
all. Scenery across a ravine belongs on that list and the tool cannot tell it from
a sealed room — you can. Run it once per scene, after the audit is clean.

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
- `scripts/audit.mjs`, `walk.mjs`, `reach.mjs`, `ground.mjs`, `shot.mjs`,
  `serve.mjs`, `export-glb.mjs`, `lib.mjs`

Scripts are zero-dependency Node (22+) driving headless Chrome over CDP. They
find Chrome themselves; set `CHROME_BIN` to override, `W3D_GL=angle` to use the
real GPU instead of the default software renderer.
