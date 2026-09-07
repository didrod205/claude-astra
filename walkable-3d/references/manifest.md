# scene.json — the manifest

One JSON object. Top-level keys: `meta`, `fov`, `spawn`, `environment`,
`materials`, `objects`.

```json
{
  "meta":   { "name": "cabin", "units": "metres", "up": "Y" },
  "fov":    68,
  "spawn":  { "position": [0, 1.7, 8], "lookAt": [0, 1.6, 0] },
  "environment": { "...": "see below" },
  "materials":   { "wall": { "color": "#d9cfbe", "roughness": 0.9 } },
  "objects":     [ "..." ]
}
```

`meta.name` becomes the exported `.glb` filename. `fov` 60–75 reads natural for
first person; below 50 feels telephoto, above 85 fisheyes the corners.

## spawn

```json
"spawn": { "position": [x, 1.7, z], "lookAt": [x, 1.6, z] }
```

`position.y` is **eye height above the floor at that point**, i.e. floor top
+ 1.7. `lookAt` sets the initial yaw and pitch; aim it slightly below eye level
so the horizon sits high and you see the ground.

## environment

| key | default | notes |
|---|---|---|
| `skyColor` | `#9fb8d4` | also the fog colour and the hemisphere sky |
| `groundColor` | `#4a4640` | hemisphere bounce colour — set it to your actual ground |
| `ambient` | `0.55` | hemisphere intensity. Above ~0.9 washes shadows out |
| `sunPosition` | `[12,20,8]` | direction of the key light |
| `sunIntensity` | `2.2` | |
| `fog` | none | `[near, far]` in metres. Adds depth outdoors; skip indoors |
| `shadowExtent` | *auto* | half-width of the shadow camera. **Leave it unset** — it is fitted to what you actually built, ignoring terrain slabs, and a hand-set value is nearly always far too generous. Every wasted metre costs resolution where the geometry is |
| `exposure` | `0.95` | ACES tone-mapping exposure |
| `envIntensity` | `0.5` | image-based light from the sky. Past ~0.6 it washes the albedo out until everything reads as the same pale grey |
| `ao` | `true` | ambient occlusion. The contact darkening that makes objects sit *in* the scene rather than on top of it |
| `aoRadius` | `1.5` | **in metres.** The library default is tuned for props; at room and building scale it produces nothing visible |
| `aoScale` | `1.6` | AO strength |
| `shadowMap` | `4096` | shadow map resolution |
| `shadowBias`, `normalBias` | `-0.0016`, `0.035` | only touch these if you see banding. `normalBias` must stay well under your thinnest wall — it offsets the shadow sample along the surface normal, and half a wall's thickness pushes it out the other side |

The three that actually change how a scene reads are `envIntensity`, `aoRadius`
and `sunIntensity`. Everything else is trim.

## materials

Named entries reused by `"material": "<name>"` on objects. An object may also
carry an inline object instead of a name.

```json
"plank": { "color": "#9c6b41", "roughness": 0.75, "metalness": 0 }
```

| key | notes |
|---|---|
| `color` | any CSS colour |
| `roughness` | 0 mirror … 1 chalk. Most real surfaces are 0.7–1.0 |
| `metalness` | 0 or 1 in practice; values between are physically meaningless |
| `opacity` | < 1 turns on transparency (glass: `0.25`, roughness `0.05`) |
| `detail` | `true` adds a faint procedural roughness break-up. **Off by default**: glTF packs roughness into a per-material image, so one shared noise map came out of the exporter once per material and a small cabin weighed 13.8 MB instead of 0.7. Turn it on only for scenes you will not export |
| `emissive`, `emissiveIntensity` | self-lit surfaces: lamps, screens, windows at night |
| `doubleSided` | for single-plane geometry seen from both sides |

Ten to twenty named materials is the right order of magnitude. Reuse is what
keeps draw calls down and the scene visually coherent.

## objects

A flat array, or nested via `children`, or both. Every entry needs a unique `id`.

```json
{ "id": "wall_n", "kind": "box", "size": [6.3, 2.6, 0.16],
  "position": [0, 1.42, -2.07], "material": "wall", "solid": true }
```

| key | meaning |
|---|---|
| `id` | **required, unique.** Becomes the node name in the `.glb` |
| `kind` | `box` `sphere` `cylinder` `cone` `torus` `plane` `group` (default `group`) |
| `parent` | id of another object; alternative to nesting under `children` |
| `children` | nested objects, positioned **relative to this one** |
| `position` | `[x, y, z]`, the object's **centre**, in metres |
| `rotation` | `[x, y, z]` in **degrees** |
| `scale` | number or `[x, y, z]` |
| `material` | material name or inline definition |
| `solid` | `true` = blocks the player. Default `false` |
| `visible` | `false` keeps it in the export but hides it |
| `castShadow` / `receiveShadow` | both default `true` |
| `bevel` | edge radius in metres. Defaults to ~1.8 cm, capped at 14% of the smallest dimension. A perfectly sharp edge is the loudest tell of untouched CAD; set `0` only when you want that |
| `vary` | `false` turns off the ±4% per-object shade variation |
| `tag` / `userData` | free-form, carried into the export |

### Per-kind geometry

| kind | keys |
|---|---|
| `box` | `size: [w, h, d]` |
| `plane` | `size: [w, h]` — faces +Z, rotate `[-90,0,0]` to lie flat |
| `sphere` | `radius`, `segments` |
| `cylinder` | `radius` or `radiusTop`/`radiusBottom`, `height`, `segments` |
| `cone` | `radius`, `height`, `segments` |
| `torus` | `radius`, `tube`, `segments` |
| `group` | none — a transform node for its children |
| `light` | `light`: `"point"` (default) or `"spot"`; `color`, `intensity`, `distance`, `decay`; spots also take `angle` (degrees) and `penumbra`. `castShadow: true` to cast |
| `terrain` | a heightfield — see below |

### Terrain

```json
{ "id": "terrain", "kind": "terrain",
  "size": [150, 150], "segments": 180, "seed": 7,
  "amplitude": 5.5, "frequency": 0.016, "octaves": 4,
  "color": "#6b8250", "slopeColor": "#8c8478", "slopeAngle": 27,
  "flatten": [{ "at": [0, 1.5], "radius": 13, "falloff": 13, "height": 0 }],
  "material": "grass", "castShadow": false }
```

Seeded value noise, so the same `seed` always gives the same landscape. It is a
mesh like any other, so **the walk controller finds it by raycast and it is
walkable for free** — you can climb a hill without doing anything else.

| field | |
|---|---|
| `size`, `segments` | extent in metres, and grid resolution. 180 over 150 m is ~0.8 m per quad; past ~250 the triangle count starts to matter more than the detail does |
| `amplitude` | peak-to-trough height, roughly. 5 is rolling, 20+ is hill country |
| `frequency` | 0.01–0.02 for landscape scale. Higher gets noisy rather than detailed |
| `octaves` | 4 is plenty |
| `seed` | change it to get a different landscape at the same settings |
| `color`, `slopeColor`, `slopeAngle` | vertex colours blended by slope — ground below the angle, rock above it, over a 16° band. Set `slopeColor` equal to `color` to switch it off |
| `flatten` | list of `{ at: [x, z], radius, falloff, height }`. Levels a disc so a building has ground to stand on |
| `material` | still applies for roughness and metalness; its colour is replaced by the slope blend |

**Make `falloff` at least as large as the surrounding relief**, or the flattened
disc reads as a cookie-cutter mesa with vertical sides — a 9 m falloff in 22 m of
relief looks like a plinth someone dropped on the landscape. A falloff equal to
the radius is a good starting point.

Anything you place on terrain has to be placed at the height the terrain
actually is. Flatten where you build, and put the buildings at that height.

### Light

An emissive material **does not emit light** — it is a bright surface, nothing
more. A lamp that lights its room is two objects: the glowing sphere and a light
inside it.

```json
{ "id": "lamp_bulb",  "kind": "sphere", "radius": 0.075,
  "position": [0.46, 1.08, 0], "material": "glow", "castShadow": false },
{ "id": "lamp_light", "kind": "light", "light": "point",
  "position": [0.46, 1.08, 0], "color": "#ffcf94", "intensity": 7, "distance": 8.5 }
```

Interiors need this. The sun cannot reach through a doorway, so a room with no
light object renders as a black box no matter how well it is built — and that is
one of the few faults neither the audit nor an exterior screenshot will show you.

**`position` is the centre, not the base.** A 2.6 m wall standing on a floor
whose top is at y = 0.12 has `position[1] = 0.12 + 1.3 = 1.42`. Getting this
wrong buries half your geometry; the audit's `layout` check catches the gross
cases but not a wall sunk 30 cm.

## Grouping

Group anything a person would want to move as a unit — a table with its legs, a
tree, a whole building. Children are relative, so the group is the handle:

```json
{ "id": "tree_2", "kind": "group", "position": [6.8, 0, 1.4], "scale": 1.25,
  "children": [
    { "id": "trunk_2", "kind": "cylinder", "radiusTop": 0.16, "radiusBottom": 0.24,
      "height": 2.6, "position": [0, 1.3, 0], "material": "bark", "solid": true },
    { "id": "crown_2", "kind": "cone", "radius": 1.5, "height": 3.4,
      "position": [0, 3.9, 0], "material": "leaf" }
  ]}
```

For repeated props, write the group once and copy it with a new `id` prefix and
a new `position`/`scale`/`rotation`. Vary the scale and yaw slightly — a row of
identical, identically-oriented trees reads as generated instantly.

## What `solid` should and should not be

| solid: true | solid: false |
|---|---|
| walls, doors, closed windows | floors, ground, terrain |
| furniture you'd bump into | rugs, road markings, decals |
| tree trunks, columns, railings | stairs and ramps (the controller steps up 0.45 m) |
| vehicles, rocks, fences | tree canopies above head height |
| | anything decorative above 2.2 m |

Collision is an axis-aligned box around the object's world bounds, so a rotated
wall collides as its bounding box. For a diagonal wall, either accept the
approximation or build it from short axis-aligned segments.
