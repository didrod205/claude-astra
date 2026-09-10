# Verification

Two tools, and they catch different things. Run both. A scene that passes the
audit can still look absurd, and a scene that photographs beautifully can be
unwalkable.

```bash
node scripts/audit.mjs  scene/            # structure    → exit 2 = broken
node scripts/walk.mjs   scene/            # movement     → exit 2 = not walkable
node scripts/shot.mjs   scene/ --out shots  # appearance  → read every image
```

## audit.mjs

Boots the scene in headless Chrome, walks the built object graph, and reports.
Exit code 0 clean · 1 warnings · 2 errors. `--json` for the raw report.

### Errors — the scene is broken

| check | message | usual cause |
|---|---|---|
| `boot` | scene failed to build | JSON syntax error, a bad `kind`, a CDN fetch that failed. The message is the page-side exception |
| `console` | any page error | a material or geometry field of the wrong type |
| `empty` | only n mesh(es) / bounding box is 0.0 m | `objects` never parsed, or every entry was skipped for a missing `id` |
| `degenerate` | *x* has zero size | a `size`/`radius`/`height` you never set, or set to 0 |
| `layout` | n/m meshes centred on the origin | you wrote objects with no `position`. They are all stacked inside each other at 0,0,0 — a screenshot of this can look like one plausible object |
| `spawn` | spawn is inside solid *x* | the player starts trapped and cannot move |
| `spawn` | no surface under the spawn point | the player falls out of the world on frame one |

### Warnings — worth a look, not always wrong

| check | message | what to think |
|---|---|---|
| `scale` | *x* is n m across | fine for terrain, wrong for a chair |
| `scale` | *x* is under 2 mm | almost always a unit slip — cm or mm treated as metres |
| `naming` | id "*x*" used n× | the `.glb` will have duplicate node names; Blender will disambiguate them for you, badly |
| `naming` | an object has no id | it built, but it is unaddressable and unexportable by name |
| `layout` | n object(s) sit entirely below y=0 | sunk geometry, usually a `position[1]` that forgot to add half the height |
| `clash` | *a* / *b* overlap by n% | furniture inside a wall, two walls doubled up. Ignore it only for deliberate intersections like a chimney through a roof |
| `spawn` | spawn floats n m above the floor | you'll start with a drop |
| `spawn` | spawn eye height is n m | not 1.7 — the whole scene will feel mis-scaled from the one viewpoint that matters most |
| `perf` | n draw calls / n M triangles | over ~900 calls, merge repeated props or cut the count |

`clash` compares axis-aligned world bounds, so a **rotated object is not
compared at all** — a pitched roof slab's axis-aligned box is far bigger than the
slab, and testing it produced a 50% "overlap" with the gable wall underneath on
the first chapel that was built with one. The audit reports how many pairs it
skipped for this reason; check pitched roofs, ramps and angled walls by eye.
Parent/child pairs are exempt too.

## walk.mjs

```bash
node scripts/walk.mjs scene/ [--seconds 8] [--dirs 8] [--json]
```

Holds W from the spawn in `--dirs` evenly spaced directions and reports what a
person would find out doing the same thing.

```
    0°    9.23 m   climb  0.14 m   end y   1.84   on ground
   90°   15.60 m   climb  0.85 m   end y   0.91   on ground
```

`distance` is the giveaway. At the walk speed of 2.6 m/s, six seconds is 15.6 m —
anything much shorter means something stopped the player, and the direction tells
you what.

| check | fails when |
|---|---|
| `walk` — could not move | no direction cleared 1 m. The spawn is boxed in |
| `walk` — only n of m directions | most headings are blocked. Usually intended indoors, suspicious outdoors |
| `walk` — ended BELOW the ground | they fall through the floor |
| `walk` — a single frame dropped >1.5 m | a hole, or a ledge with nothing under it |
| `walk` — airborne more than half the time | the ground is not carrying them |

A run that falls well short of the expected distance names what stopped it:
`stopped by stove_body`. A 5 cm marker post and a wall look identical in the
distance column, and only one of them is a problem.

**This is the only check that catches a building you cannot enter.** The bundled
cabin audited clean for several revisions while its own door leaf, ajar at 26°,
left 12 cm of a 1 m opening — plenty to look at, impossible to walk through.

## ground.mjs

```bash
node scripts/ground.mjs scene/ 12,-4 0,0 -8,15
node scripts/ground.mjs scene/ --grid -20,-20,20,20,5
```

Prints the ground height at each point, tab-separated. Terrain is generated from
seeded noise **inside the page**, so this is the only honest way to seat a prop
on a hillside without reimplementing that noise wherever you author the
manifest. Where a scene has terrain the query hits the terrain specifically —
you want the hillside under the hut, not the hut's roof.

Use it before placing anything outside a `flatten` disc.

## shot.mjs

```bash
node scripts/shot.mjs scene/ --out shots [--w 1280] [--h 800] [--scale 1|2]
node scripts/shot.mjs scene/ --pose 3,1.7,2@0,1.6,-4      # a specific viewpoint
node scripts/shot.mjs scene/ --plan 2.6 --plan 5.4        # cutaway plan per storey
node scripts/shot.mjs scene/ --only spawn                  # just the arrival shot
```

Default set — **read all six**:

| shot | what only this one shows |
|---|---|
| `spawn` | what the user actually sees first. Scale, framing, whether anything is worth walking to |
| `orbit-0/90/180/270` | the sides you did not think about. Missing back walls, hollow buildings, props floating beside the model rather than in it |
| `top` | the footprint and the site. **On a roofed building it shows a roof and nothing else** — use `--plan` for those |

### Rendering cost

Headless renders through **software WebGL** by default, so it works anywhere with
no GPU assumptions — and it is slow: with ambient occlusion and bloom on a
120-object scene, one 1280×800 frame at `--scale 2` takes about a minute, and the
default six take three. Two levers:

- `--scale` **defaults to 2**. Pass `--scale 1` with a smaller `--w/--h` when you only need to know that something
  rendered rather than to look at it closely. 640×400 at scale 1 is ~12 s.
- `W3D_GL=angle` uses the real GPU and is far faster. Use it for the shots you
  are actually going to look at.

Every DevTools call is bounded at two minutes, so a browser that stops answering
fails with a message instead of hanging the run.

Framing ignores terrain-sized ground slabs, so a 6 m cabin on a 60 m lawn frames
on the cabin. Poses are computed from the subject bounds every run, so they stay
correct as the scene grows.

### `--plan` — the only view of an interior

```bash
node scripts/shot.mjs scene/ --out shots --plan 2.6 --plan 5.4
```

Hides everything sitting entirely above the cut and shoots straight down. **For
anything enclosed — a house, a room, a level — this is the highest-value image
of the set, and none of the other six can substitute for it.** A roofed building
is opaque from every external angle: the six default shots of a two-storey
townhouse showed four brick elevations and a roof, and revealed nothing about the
stairs, the stairwell opening, or a single piece of furniture inside it. One
`--plan` cut showed all of it.

Pass one cut per storey, just under that storey's ceiling — for a house with
floors at 0.15 and 3.0 and a 2.6 m storey height, `--plan 2.6 --plan 5.4`. The
result names the file after the height and reports how many objects it hid, which
is a quick sanity check in itself: hiding 0 means your cut is above everything.

Read a plan for: rooms that don't tile, furniture inside walls, a stairwell
opening that doesn't line up with the stairs, circulation you cannot actually
walk through, and a footprint that isn't the shape you thought.

### Reading the images

Ask these in order, and answer them from the pixels, not from the manifest:

1. **Is the scene the shape I intended?** (top)
2. **Is anything floating or buried?** (orbit — look at where objects meet the ground)
3. **Does the front view have a back?** (compare orbit-0 and orbit-180)
4. **Does a 1.7 m person fit through, under, and past everything?** (spawn)
5. **Is the light doing anything?** Flat, shadowless output means the sun is
   inside geometry or `shadowExtent` is smaller than the scene.
6. **Would a person believe the scale?** Put the door next to the human eye line.

If a screenshot is black: the camera is inside a solid, or the scene failed to
build and the audit will say so. If it's flat grey: `ambient` is too high or the
sun is occluded.

## Walking it yourself

```bash
node scripts/serve.mjs scene/ --open
```

Click to lock the pointer. WASD, Shift to run, Space to jump, Esc to release,
**G to download a `.glb`**. The HUD shows fps, draw calls, triangles, and your
position — read a position off the HUD to write a `--pose` for a repeatable shot.

Hand this to the user when the audit is clean and the shots look right. It is
the only check that catches "the collision is technically correct but walking
through the doorway is annoying."


## Reachability — `reach.mjs`

Every check above is about whether the scene is *built* correctly. This one is
about whether it can be *used*.

```bash
node scripts/reach.mjs my-scene [--cell 1.0] [--radius 45] [--from x,y,z]
```

It flood-fills the walkable space from spawn. Each edge is a real walk with the
real controller — hold W for one cell's worth of time and see where you end up —
so a step that is too high, too narrow, or off a drop is simply not an edge. Then
for every named object it reports the nearest place a person can stand.

**Read the floor-level list, not the total.** Roofs, ceilings and lights sit above
head height and are legitimately out of reach; the tool separates them out. What
matters is furniture, doors, props — things that are meant to be walked up to.

**What it was built to catch.** Close the bundled cabin's door across its own
doorway and `audit.mjs` still exits clean: the spawn is fine, the ground holds
you, nothing is buried, no doorway is too narrow because the doorway is still
there. `reach.mjs` reports eleven objects out of reach, and they are the entire
contents of the room.

**Cost.** About a minute on a 70 x 70 m scene. It used to be unaffordable: the
controller's `floorAt` raycast every collider, terrain included, and a 140x140
heightfield is 39,200 triangles with nothing to accelerate it — 6.8 ms for one
floor query. Terrain is a regular grid, so it is now sampled analytically and
everything else is raycast only if its footprint contains the point. Same answers
to 14 mm on 4,000 random samples, 790 times faster, and `walk.mjs` and the audit's
spawn-drift check got the same speedup for free.
