/**
 * All AI prompts used by StoneSight live here so they can be reviewed in one
 * place (see rules.md §3: prompts must be strictly scoped and carry explicit
 * negative instructions for everything that must NOT change).
 */

export interface StoneInfo {
  name: string;
  category?: string;
  tone?: string;
  description?: string;
}

/**
 * System prompt for the scene analyser (Claude vision; reused verbatim by the
 * NVIDIA VLM fallback). The output schema is enforced separately with
 * structured outputs, so this prompt focuses on *how* to measure.
 */
export const SCENE_ANALYSIS_SYSTEM_PROMPT = `You are the scene-analysis engine of StoneSight AI, a tool that shows homeowners what their own room would look like with a new luxury stone surface (quartz, Dekton, marble, granite).

You receive: (1) the customer's room photo, (2) the same photo with a labelled coordinate grid (lines every 0.1), and (3) a swatch of the stone they chose.

Your analysis drives three renderers, so geometric accuracy matters more than prose:
- a perspective texture-mapper that paints the stone onto each surface quad,
- a 3D reconstruction that the customer can walk around in first person,
- NVIDIA image and video models that need precise instructions.

Coordinates: every point is normalised to the ORIGINAL photo — x from 0 (left edge) to 1 (right edge), y from 0 (top edge) to 1 (bottom edge). Use the grid photo to read positions to about ±0.01. Points may fall slightly outside 0–1 when a corner is cut off by the frame; extrapolate them along the visible edges.

Stone surfaces — list every surface that is, or would naturally be, made of stone: countertops, island tops, waterfall sides, visible front edges of slabs, backsplashes that are stone (not tiles), vanity tops, table tops, fireplace surrounds, shower walls. Do NOT include cabinets, doors, appliances, sinks, tiles, glass, or furniture upholstery.
For each surface:
- quad: the 4 corners of the full plane of the surface in perimeter order, as if nothing stood on it. For a horizontal top, go around the slab; edge 0→1 is the long side. For a vertical face, give top-left, top-right, bottom-right, bottom-left.
- polygon: the visible outline of the stone only, excluding sinks, hobs, taps and objects resting on it (6–24 points).
- height_m: height of a horizontal top above the floor (kitchen counters ≈0.9, islands 0.9–0.95, vanities 0.8–0.9, tables 0.75). For vertical faces, the height of the bottom edge.
- length_m / depth_m: real-world sizes along edge 0→1 and edge 1→2. thickness_m: slab thickness (usually 0.02–0.06).

Camera: estimate the horizontal field of view of the photo (phone main camera ≈ 65–75° on the long side; portrait photos have a narrower horizontal FOV than landscape), the photographer's eye height (usually 1.4–1.7 m) and the downward pitch.

Back wall: the floor and ceiling corners of the farthest wall facing the camera. If the room continues out of frame, extrapolate the corners along the floor/ceiling lines.

Colours: representative #rrggbb for walls, floor, ceiling and cabinet fronts.

edit_instruction: one paragraph for the FLUX.1 Kontext image-editing model. It sees ONLY the room photo, never the swatch, so describe the chosen stone concretely (base colour, veining colour/direction/scale, finish) using the swatch and the stone description. Name the exact surfaces to change by their position in the photo. Then state what must not change: camera angle, framing, room layout, cabinets, appliances, sink, taps, walls, floor, ceiling, lighting, shadows, reflections, objects and people.

video_prompt: one paragraph for the NVIDIA Cosmos image-to-video model. The video starts from this exact photo (already showing the new stone) and must be a first-person walkthrough at human eye level (~1.6 m): steady handheld-gimbal motion, the viewer slowly looks left, then right across the room, then takes a few steps toward the main stone surface while the camera gently tilts down to show its grain and reflections. Ask for natural light, realistic parallax and physically consistent geometry. State that no people, text or new objects appear and the room layout, cabinets and stone pattern stay identical throughout.`;

export function sceneAnalysisUserPrompt(stone: StoneInfo): string {
  return [
    `Selected stone: ${stone.name}${stone.category ? ` (${stone.category}` : ""}${stone.tone ? `, ${stone.tone} tone` : ""}${stone.category ? ")" : ""}.`,
    stone.description ? `Manufacturer description: ${stone.description}` : "",
    "Analyse the room photo and return the scene JSON.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Template edit instruction used when no analyser is configured (NVIDIA-only
 * setups without a VLM) or the analyser returned an empty instruction.
 */
export function fallbackEditInstruction(stone: StoneInfo): string {
  return [
    `Replace only the stone surfaces in this photo — countertops, island top, waterfall sides, slab edges, stone backsplash and vanity tops — with ${stone.name}${stone.category ? ` ${stone.category.toLowerCase()}` : ""}.`,
    stone.description ? `The new stone looks like this: ${stone.description}` : "",
    "Keep the veining natural and continuous across each slab, with realistic polished reflections that match the existing lighting.",
    "Do not change anything else: keep the exact camera angle, framing and perspective, the room layout, cabinets, doors, handles, appliances, sink, taps, walls, tiles, floor, ceiling, lights, windows, objects, shadows and reflections exactly as they are.",
    "Do not add, remove or move any object.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function fallbackVideoPrompt(stone: StoneInfo): string {
  return [
    `First-person walkthrough of this room at human eye level (about 1.6 m), shot on a steady gimbal, featuring new ${stone.name} stone surfaces.`,
    "The viewer slowly looks left, then pans right across the room, then takes a few calm steps toward the main stone surface while tilting down slightly to reveal its grain, veining and polished reflections.",
    "Natural daylight, realistic parallax and depth, physically consistent geometry, smooth motion without flicker.",
    "No people, no text, no new objects; the room layout, cabinets, appliances and the stone pattern stay identical throughout.",
  ].join(" ");
}

export const VIDEO_NEGATIVE_PROMPT =
  "people, hands, text, watermark, logo, blurry, low quality, flicker, warping walls, melting geometry, morphing furniture, changing stone pattern, fisheye distortion, fast motion, camera shake";
