# Scale and layout

Everything here is in metres because the manifest is in metres. Scale errors are
the single largest source of "it looks wrong and I can't say why."

## Human reference

| | m |
|---|---|
| eye height, standing adult | **1.70** |
| shoulder width | 0.45 |
| comfortable walking gap | 0.90 |
| stride | 0.75 |

The camera is 1.7 m up and 0.7 m wide. If a corridor is 0.8 m wide it will feel
like a coffin; if a room is 12 m tall it will feel like a train station. Neither
shows up in an orbit screenshot — only in the spawn shot and only if you look.

## Architecture

| | m |
|---|---|
| ceiling, residential | 2.40 – 2.70 |
| ceiling, office / retail | 2.70 – 3.50 |
| interior wall thickness | 0.10 – 0.15 |
| exterior wall thickness | 0.20 – 0.40 |
| door opening | 0.90 w × 2.05 h |
| door, double / entrance | 1.60 w × 2.10 h |
| window sill height | 0.90 |
| window | 1.20 w × 1.40 h |
| stair riser / tread | 0.18 / 0.28 |
| storey height (floor to floor) | 3.00 – 3.30 |
| corridor width | 1.20 – 1.80 |
| balcony depth | 1.20 – 2.00 |

## Rooms

| | m |
|---|---|
| bedroom | 3.0 × 3.6 |
| double bedroom | 3.6 × 4.2 |
| bathroom | 2.0 × 2.4 |
| kitchen | 3.0 × 3.6 |
| living room | 4.5 × 5.5 |
| single office desk zone | 1.8 × 1.8 |

## Furniture

| | w × d × h |
|---|---|
| dining table | 1.40 × 0.85 × 0.75 |
| desk | 1.40 × 0.70 × 0.75 |
| chair seat | 0.45 × 0.45 × 0.45 (back to 0.95) |
| sofa, 3-seat | 2.10 × 0.90 × 0.80 |
| single bed | 1.00 × 2.00 × 0.55 |
| double bed | 1.50 × 2.00 × 0.55 |
| wardrobe | 1.20 × 0.60 × 2.10 |
| bookshelf | 0.90 × 0.30 × 1.80 |
| kitchen counter | — × 0.60 × 0.90 |
| fridge | 0.70 × 0.70 × 1.80 |
| TV, 55" | 1.25 × 0.08 × 0.72 |

## Outdoors and urban

| | m |
|---|---|
| car | 4.5 × 1.8 × 1.5 |
| bus | 12.0 × 2.5 × 3.2 |
| traffic lane | 3.0 – 3.5 |
| pavement | 1.5 – 3.0 |
| street tree | 6 – 12 tall, canopy 4 – 8 wide |
| lamp post | 5 – 9 |
| street block | 80 – 200 |
| terraced house frontage | 5 – 7 |
| shopfront | 6 – 10 |

## Lay out before you write geometry

Sketch a metre grid in your head or in a comment block, then place. In practice:

1. **Fix the footprint.** "The cabin is 6 × 4 interior, walls 0.16, so the
   exterior box is 6.32 × 4.32 and the wall centres are at ±3.07 and ±2.07."
2. **Fix the floor top.** Everything above stands on it. If the floor is a
   0.12 m slab centred at y = 0.06, its top is 0.12 and every object's
   `position[1]` is `0.12 + height/2`.
3. **Cut the openings.** A doorway is two wall segments plus a lintel, not one
   wall. Compute the segment widths: for a 6.3 wall with a 1.2 opening centred,
   each side is `(6.3 - 1.2) / 2 = 2.55`, centred at `±(1.2/2 + 2.55/2) = ±1.875`.
4. **Place furniture against walls first**, then into the middle. Leave 0.9 m of
   walking space. `audit.mjs`'s `clash` check finds what you overlap; it cannot
   find what you left no room to walk through — the spawn shot does.
5. **Then the outside**: ground, path, planting, distant filler.

## Making it not look generated

- **Vary.** Same prop three times at the same scale and yaw is the tell. Change
  `scale` by ±20% and `rotation[1]` by ±30° per instance.
- **Break the grid.** Perfectly aligned everything reads as CAD. Rotate a chair
  8°, push a rug 15 cm off centre.
- **Give the eye a path.** From the spawn point there should be something worth
  walking to — a lit doorway, a gap between buildings.
- **One warm light source, and an actual light with it.** `emissive` makes a
  surface glow; it emits nothing. Pair it with a `kind: "light"` object or the
  room stays dark. This is the single biggest difference between an interior
  that reads as a room and one that reads as a box.
- **Cut real openings.** A wall with a window — two segments, a lintel, a sill,
  a glass pane and a frame — costs six objects and changes the whole read of a
  facade. A blank wall with a door hole is the greybox look.
- **Colour discipline.** Six to ten materials for a room, not thirty. Real
  interiors are mostly two or three neutrals plus accents.

## Lighting presets to start from

```json
"interior day":  { "skyColor": "#cfe0f2", "groundColor": "#8b8378", "ambient": 0.75,
                   "sunPosition": [8, 14, 6], "sunIntensity": 1.8, "exposure": 1.05 }
"exterior day":  { "skyColor": "#a8c4e0", "groundColor": "#5c6b4a", "ambient": 0.6,
                   "sunPosition": [14, 22, 10], "sunIntensity": 2.4, "fog": [8, 90] }
"overcast":      { "skyColor": "#c6cbd2", "groundColor": "#6e6f6b", "ambient": 0.95,
                   "sunPosition": [6, 24, 4], "sunIntensity": 0.9, "fog": [5, 55] }
"golden hour":   { "skyColor": "#f0c08a", "groundColor": "#6b5540", "ambient": 0.5,
                   "sunPosition": [26, 6, 12], "sunIntensity": 3.0, "fog": [10, 120],
                   "exposure": 1.15 }
"night":         { "skyColor": "#0e1626", "groundColor": "#0a0f18", "ambient": 0.22,
                   "sunPosition": [-14, 18, -8], "sunIntensity": 0.35, "fog": [4, 45] }
```

At night, light the scene with `emissive` materials **plus light objects** —
lamps, windows, signs — not by raising `ambient`, which just makes everything
grey. `envIntensity` should come down at night too; the sky has little to give.
