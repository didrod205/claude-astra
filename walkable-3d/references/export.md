# Getting the scene out

```bash
node scripts/export-glb.mjs scene/ --out cabin.glb
```

Binary glTF with **node names and parenting preserved** — the `id` you wrote in
the manifest is the object name in Blender's outliner, and a `group` is a parent
empty with its children under it. That is the whole reason for authoring a
manifest rather than imperative scene code.

The in-page **G** key does the same thing from a browser session.

## Blender

*File → Import → glTF 2.0 → cabin.glb*

- Everything arrives at the right scale: glTF is metres and so is Blender.
- +Y up in glTF becomes +Z up in Blender; the importer handles it.
- Groups import as empties. Select one and everything under it moves together.
- Materials import as Principled BSDF with base colour, roughness, metalness,
  and emission carried over.

**What will not be good enough for every use:** the topology. These are
primitive meshes — a box is 12 triangles, a cylinder is a fan. That is exactly
right for blockout, previz, level greyboxing, architectural massing, and
real-time backgrounds. It is not right for subdivision surface modelling,
sculpting, or clean UV unwrapping of organic shapes. If the user needs that,
what you hand over is a **correctly-proportioned, correctly-laid-out base** for
a modeller to retopologise — say so rather than implying it's production
geometry.

## Unreal Engine 5

Drag the `.glb` into the Content Browser. In the import dialog:

- **Combine Meshes: off** — otherwise the whole point (separable objects) is lost.
- **Generate Collision: on** for a walkable pass; simple box collision matches
  how the manifest's `solid` flags already behave.
- **Import Materials: on**; expect to rebuild anything emissive as a real
  emissive material with bloom.
- Scale is 1:1 — Unreal's unit is the centimetre but the glTF importer converts.

Drop a Player Start at the manifest's `spawn.position` (multiply by 100 for
Unreal's centimetres) and you have the same walkthrough.

## Other targets

| target | how |
|---|---|
| Godot | import the `.glb` directly; it is Godot's native 3D format |
| three.js in another app | load the `.glb` with `GLTFLoader` |
| USDZ / Reality Composer | convert the `.glb` with Apple's `usdzconvert` |
| static render | `scripts/shot.mjs --pose` at `--w 2400 --h 1500` |

## When Blender is installed and you want to go the other way

`blender --background --python script.py` runs `bpy` headlessly, and a manifest
maps onto it almost one-to-one: `bpy.ops.mesh.primitive_cube_add`,
`obj.name = id`, `obj.parent = groups[parent]`, `obj.scale`, `obj.location`.

Reach for that path only when you need something the manifest genuinely cannot
express — booleans, modifiers, bevels, particle scattering, procedural
materials, or a render through Cycles. The cost is that you lose the walk test
and the audit, which is where most of the quality actually comes from. A good
compromise: author and verify the layout as a manifest, export the `.glb`, then
run a short `bpy` script that imports it and applies the modifiers.

Check first — Blender is not installed everywhere:

```bash
command -v blender || ls /Applications/Blender.app/Contents/MacOS/Blender
```

If it isn't there, say so and deliver the `.glb`; don't silently skip the step.
