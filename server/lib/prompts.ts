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

Countertop surfaces — StoneSight performs SURGICAL COUNTERTOP REPLACEMENT: only the existing countertop slabs change. List every existing countertop surface: kitchen worktops, island tops, peninsula and breakfast-bar tops, and vanity tops — plus, only where the photo already shows them as part of the same slab, their visible front edges and waterfall ends. A waterfall end exists only if the photo already shows a stone panel running down to the floor; a cabinet-fronted or wood-panelled island side is NOT a waterfall. Do NOT include backsplashes (tiled or stone), walls, wall cladding, shower walls or floors, fireplace surrounds, floors, cabinets, doors, appliances, sinks, hobs, glass or upholstery.
For each surface:
- quad: the 4 corners of the full plane of the surface in perimeter order, as if nothing stood on it. For a horizontal top, go around the slab; edge 0→1 is the long side. For a vertical face, give top-left, top-right, bottom-right, bottom-left.
- polygon: the visible outline of the stone only, excluding sinks, hobs, taps and objects resting on it (6–24 points).
- height_m: height of a horizontal top above the floor (kitchen counters ≈0.9, islands 0.9–0.95, vanities 0.8–0.9, tables 0.75). For vertical faces, the height of the bottom edge.
- length_m / depth_m: real-world sizes along edge 0→1 and edge 1→2. thickness_m: slab thickness (usually 0.02–0.06).

Camera: estimate the horizontal field of view of the photo (phone main camera ≈ 65–75° on the long side; portrait photos have a narrower horizontal FOV than landscape), the photographer's eye height (usually 1.4–1.7 m) and the downward pitch.

Back wall: the floor and ceiling corners of the farthest wall facing the camera. If the room continues out of frame, extrapolate the corners along the floor/ceiling lines.

Colours: representative #rrggbb for walls, floor, ceiling and cabinet fronts.

edit_instruction: one paragraph for the photoreal image editor (a Gemini image model that also sees the swatch, or FLUX.1 Kontext, which sees only the room photo). Begin with "Surgically replace only the countertop surfaces:" and name each countertop by where it is in the photo (e.g. "the long island top running from the left foreground to the back right, including its thin front edge and the waterfall end facing the camera", "the counter under the window left of the hob"). Describe the chosen stone concretely (base colour, veining colour/direction/scale, finish) so the editor gets it right even without the swatch. Then name the neighbouring things that must stay exactly as they are, saying what each one is in this photo — the backsplash (e.g. "the white subway-tile backsplash"), the walls, the cabinet fronts and island side panels, the sink, tap and hob, appliances, stools and floor — and state that each countertop keeps its exact shape, thickness and edge profile and that the camera, framing and everything else stay identical. Never ask for new objects, new waterfall panels or a different countertop shape.

video_prompt: one paragraph for the NVIDIA Cosmos image-to-video model. The video starts from this exact photo (already showing the new stone) and must be a first-person walkthrough at human eye level (~1.6 m): steady handheld-gimbal motion, the viewer slowly looks left, then right across the room, then takes a few steps toward the main stone surface while the camera gently tilts down to show its grain and reflections. Ask for natural light, realistic parallax and physically consistent geometry. State that no people, text or new objects appear and the room layout, cabinets and stone pattern stay identical throughout.`;

/** Second-pass instruction: correct the analysis using its own overlay. */
export const REFINE_PROMPT = `Check every outline against the actual photo and correct it:
- Each polygon must hug the visible stone of that surface exactly — the top face of a counter/island, the full face of a waterfall or backsplash — and must not spill onto cabinets, stools, floor, walls or appliances.
- Each quad must cover the whole plane of its surface with corners in the documented order.
- Add any stone surface you missed and remove any surface that is not stone.
- Re-check heights, sizes, camera and back wall so they are consistent with what the overlay shows.
Keep everything that is already correct. Return the complete corrected JSON object only.`;

/** Grounding pass: map each surface onto numbered photo regions (set-of-mark). */
export function groundingPrompt(surfaceIds: string[], regionCount: number): string {
  return `The photo has been divided into ${regionCount} numbered regions (yellow outlines follow real edges in the photo; each number sits inside its region).
For each of your surfaces (${surfaceIds.join(", ")}), list every region number that shows the stone of THAT surface — the visible top face of a counter/island, the full face of a waterfall side or backsplash, etc. Include a region when most of it is that stone; leave out regions that are mostly cabinets, stools, floor, walls, appliances, sinks, taps or objects. A marble face is often split into several regions along its veins — include all of them.
Return ONLY one JSON object (no markdown): {"assignments":[{"surface_id":"<id>","regions":[<numbers>]}]}`;
}

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
 * Prompt for the generative image editor (Gemini image models). Built on the
 * original StoneSight prompt that produced the best results with Gemini —
 * "Surgically replace countertops with <stone>. Material description: … Ensure
 * the veining, color, and finish match this description exactly." — plus
 * Claude's countertop-by-countertop instruction and explicit limits so the
 * edit never spreads to backsplashes, walls, cabinets or new waterfall panels
 * (rules.md §3).
 */
export function stoneEditPrompt(stone: StoneInfo, claudeInstruction: string, hasSwatch: boolean): string {
  return [
    `Surgically replace the countertops in Image 1 with ${stone.name}${stone.category ? ` (${stone.category})` : ""}. Only the existing countertop slabs change; nothing else in the photo changes.`,
    stone.description ? `Material description: ${stone.description}` : "",
    hasSwatch
      ? "Image 2 is a sample of this exact stone. Ensure the veining, color, and finish match it exactly: the same base colour, vein colour, vein width, scale and direction."
      : "Ensure the veining, color, and finish match this description exactly.",
    claudeInstruction ? `Countertops to change (from a precise analysis of this photo): ${claudeInstruction}` : "",
    "Keep every countertop's exact shape, outline, thickness and edge profile, and keep the stone strictly inside the existing countertop area. Do not extend it onto the backsplash, walls, tiles, cabinet fronts, island side panels, floor or appliances, and do not add waterfall ends, extra slabs or any new objects.",
    "Blend it into the photo's existing lighting: the veining flows naturally across each slab and over its visible edge, with the same highlights, shadows and reflections the original counters had. Objects on the counters stay in place on top of the new stone.",
    "Everything else stays identical with 100% fidelity: camera position, framing, crop, perspective and aspect ratio; cabinets, doors, handles, appliances, sink, tap, hob, stools, backsplash, walls, floor, ceiling, lights, windows, decor and colour grading. Return only the edited photograph.",
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
    `Surgically replace only the countertops in this photo — worktops, island top, vanity top and their visible slab edges (and a waterfall end only where one already exists) — with ${stone.name}${stone.category ? ` ${stone.category.toLowerCase()}` : ""}.`,
    stone.description ? `The new stone looks like this: ${stone.description}` : "",
    "Keep the veining natural and continuous across each slab, with realistic polished reflections that match the existing lighting.",
    "Do not change anything else: keep the exact camera angle, framing and perspective, the room layout, backsplash, cabinets, island side panels, doors, handles, appliances, sink, taps, walls, tiles, floor, ceiling, lights, windows, objects, shadows and reflections exactly as they are.",
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
