# Interactive 3D Walkthrough

The results page includes a first-person 3D version of the customer's room with
the chosen stone. It runs entirely in the browser (three.js / WebGL) and needs
no extra AI calls: it is built from the generated image plus Claude's scene
analysis.

## Controls

| Input | Action |
|-------|--------|
| Click the view | Capture the mouse (pointer lock) — move the mouse to look around |
| Click-and-drag | Look around without pointer lock |
| `W` `A` `S` `D` / `↑` `↓` | Walk forward / left / back / right |
| `←` `→` / `Q` `E` | Turn left / right |
| `Shift` | Walk faster |
| `Esc` | Release the mouse |
| Viewpoint buttons | Glide to the photo view, each of the four room corners, or a close-up of the stone |
| Mini-map (bottom right) | Click anywhere on the floor plan to walk there |
| Touch | Drag to look; on-screen pad to walk |
| ⤢ button | Fullscreen |

The viewer stays at eye height, cannot walk through walls, counters or
islands (it slides along them like in a game), and has a subtle head bob while
walking.

## How the room is reconstructed (`src/scene/roomGeometry.ts`)

1. **Camera.** A pinhole camera at `(0, eye_height, 0)` looking down −Z with
   Claude's field of view and pitch. `pixelRay` / `projectToImage` convert
   between normalised image points and world rays.
2. **Back wall.** Claude's floor corners of the far wall are intersected with
   the floor plane (y = 0), which fixes the wall's distance, width and
   orientation in metres; the ceiling corners give the ceiling height. This is
   the classic *Tour Into the Picture* construction.
3. **Room box.** The floor rectangle spans the back wall and extends
   `space_behind_camera_m` behind the photographer. It is widened
   automatically so the camera and every reconstructed surface fit inside.
   Without a usable back wall, Claude's metric `room_estimate` is used.
4. **Stone surfaces.**
   - Horizontal tops (countertops, islands, vanities, tables): each quad
     corner is intersected with the plane `y = height_m` → a metric footprint.
     Built as a stone slab of `thickness_m` with a cabinet body underneath
     (tables get a pedestal).
   - Vertical faces (waterfall sides, backsplashes, cladding): the bottom edge
     is intersected with `y = height_m`; the top corners are intersected with
     the vertical plane through that edge.
5. **Obstacles and viewpoints.** Slab and panel footprints become collision
   polygons. Viewpoints are placed 0.6 m inside each corner (nudged toward the
   centre until free) facing the room centre, plus a close-up on the photo side
   of the largest slab.

The geometry is covered by round-trip tests (`tests/roomGeometry.test.ts`): a
synthetic room is projected into a "photo" and reconstructed to within 2 cm.

## How it is rendered (`src/scene/RoomScene.ts`)

**Projective texturing with visibility.** The generated image is projected
from the original camera onto all the geometry. A depth pre-pass from that
camera decides, per pixel, whether the photo actually saw the surface:

- Seen by the photo → the photo's pixel (so the start view matches the
  generated image exactly).
- Not seen (behind the island, outside the frame, behind the photographer) →
  Claude's estimated wall/floor/ceiling/cabinet colour with soft shading; for
  stone, the real swatch texture (trimmed of catalogue margins) with a polished
  two-light sheen.
- Edges of the photo frame and grazing angles fade smoothly to the fallback,
  so there are no hard seams.

Stone UVs are in metres along the slab's long axis (0.9 m per swatch tile,
mirrored repeat), so veins run along the island rather than across it.

## Limitations (single-photo input)

- Only what the photo shows is photographic; the rest of the room (behind
  the camera, beyond the frame) is plain colour. Wider photos give a more
  complete room.
- Objects such as stools, taps and pendant lights are painted onto the
  surfaces behind them (they are not separate 3D objects), so they stretch
  when viewed from far off the original angle.
- Geometry accuracy follows Claude's measurements; the sanitiser clamps
  impossible values, and the room is widened rather than clipped when
  estimates disagree.

## Testing

`npm run test:e2e` drives the real UI in Chromium: it checks the viewpoints,
keyboard walking and turning, mouse-drag look and collision (the viewer
cannot enter the island), and saves screenshots of every viewpoint to
`tests/e2e/output/`.
