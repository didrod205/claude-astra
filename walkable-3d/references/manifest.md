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
| `shadowExtent` | `30` | half-width of the shadow camera. Must cover the built area or shadows clip |
| `exposure` | `1.0` | ACES tone-mapping exposure |

`shadowExtent` is the one people get wrong: leave it at 30 on a 200 m city block
and every shadow past 30 m vanishes. Set it to roughly your scene radius.

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
