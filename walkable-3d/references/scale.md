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

## What makes a room read as a room

Six things, in the order they pay off. None of them is a texture — a single
procedural noise map applied to everything reads as burlap on the walls and
camouflage on the bedding, which is worse than a clean flat surface. Without
real assets the credible target is **stylised**, and stylised is carried by
light, colour and geometry.

1. **Skirting.** A 10 cm board where wall meets floor. The junction of two flat
   planes is a hard line with nothing to catch a shadow, and its absence is the
   single loudest reason a rendered interior reads as a box.
2. **Window reveals and a sill that sits proud.** A window is not a hole with a
   frame: it is a returned face the thickness of the wall, plus a board that
   projects past it. Six extra objects, and the facade stops being a decal.
3. **A lit ceiling.** The sun cannot get in, so a ceiling with no light on it
   goes black and the room reads as a cave. One dim warm light near the ceiling
   costs one object.
4. **Warm against cool.** A warm lamp on one side and daylight through a window
   on the other gives every surface two different colours to be shaded by. A
   room lit by one source of one colour looks like a render; a room lit by two
   of different colours looks like a room.
5. **Layered soft furnishing.** A bed is not three coloured slabs. It is a
   headboard, a frame, a mattress, a duvet that overhangs the sides, a folded
   return at the top, and two pillows leaning on something. Six objects instead
   of three, and it stops being furniture-shaped and starts being furniture.
6. **A tight palette.** Two warm neutrals, one or two woods, one cool, one
   accent. Twenty muddy browns is not a palette, it is an absence of one.

## And outside

The same idea, different parts. An elevation is a blank plane with holes in it
until you give it these:

1. **A plinth.** A course around the base, standing 10-15 cm proud. A wall that
   meets grass on a bare line looks pasted onto the ground. Build it as a
   perimeter, not a slab — as a slab it reaches in under the floor, and the
   audit will find it inside your furniture.
2. **Corner boards.** A thin vertical at each corner. It is the only thing
   breaking a long blank facade into planes.
3. **A door leaf, ajar.** An opening with nothing in it is a hole. A leaf at
   20-30° costs three objects and is what makes the front read as an entrance —
   and it lets the lit interior show, which is worth more than any exterior
   detail.
4. **Trees that frame rather than block.** Push them to the sides and back. Four
   large cones directly in front of the subject is the most common way a good
   building is photographed badly. Vary height, girth, tilt and facet count.
5. **Leave the ground alone.** A hard-edged rectangle of "gravel" or a lighter
   patch of "meadow" lying on a flat plane reads as a rendering bug, not as
   landscaping. Flat grass with one path is better than flat grass with
   rectangles on it. Ground variation needs real terrain, and that is a
   different job.

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
