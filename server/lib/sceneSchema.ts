/**
 * Zod schema for the scene analysis returned by Claude (structured outputs)
 * and by the NVIDIA VLM fallback. It mirrors `shared/scene.ts`.
 *
 * The schema deliberately avoids numeric/array-length constraints: structured
 * outputs guarantee the *shape*, and `sanitizeScene()` enforces the physical
 * ranges afterwards.
 */
import { z } from "zod";
import { ROOM_TYPES, SURFACE_KINDS } from "../../shared/scene";

const Point = z.object({
  x: z.number().describe("Normalised horizontal position: 0 = left edge, 1 = right edge"),
  y: z.number().describe("Normalised vertical position: 0 = top edge, 1 = bottom edge"),
});

const Surface = z.object({
  id: z.string().describe("Short snake_case id, unique within this scene"),
  label: z.string().describe("Human description, e.g. 'Island top'"),
  kind: z.enum(SURFACE_KINDS as [string, ...string[]]),
  orientation: z.enum(["horizontal", "vertical"]),
  height_m: z
    .number()
    .describe("Horizontal surfaces: top-face height above the floor in metres. Vertical: height of the bottom edge above the floor."),
  quad: z
    .array(Point)
    .describe(
      "Exactly 4 corners of the full surface plane in perimeter order. Edge 0→1 runs along length_m, edge 1→2 along depth_m. Corners hidden behind objects or cropped by the frame are extrapolated.",
    ),
  polygon: z
    .array(Point)
    .describe("Visible outline of the stone itself (6–24 points), excluding sinks, hobs, taps and objects standing on it."),
  length_m: z.number(),
  depth_m: z.number(),
  thickness_m: z.number(),
});

export const SceneAnalysisSchema = z.object({
  room_type: z.enum(ROOM_TYPES as [string, ...string[]]),
  summary: z.string().describe("One sentence describing the room and its current stone surfaces"),
  camera: z.object({
    horizontal_fov_deg: z.number(),
    eye_height_m: z.number(),
    pitch_deg: z.number().describe("Negative when the camera looks down"),
  }),
  back_wall: z
    .object({
      floor_left: Point,
      floor_right: Point,
      ceiling_left: Point,
      ceiling_right: Point,
    })
    .nullable()
    .describe("Corners of the farthest wall facing the camera; may extend outside the frame. Null only if no wall is visible."),
  room_estimate: z.object({
    width_m: z.number(),
    depth_m: z.number(),
    ceiling_height_m: z.number(),
    space_behind_camera_m: z.number(),
  }),
  colors: z.object({
    walls: z.string().describe("#rrggbb"),
    floor: z.string().describe("#rrggbb"),
    ceiling: z.string().describe("#rrggbb"),
    cabinets: z.string().describe("#rrggbb"),
  }),
  surfaces: z.array(Surface),
  edit_instruction: z.string(),
  video_prompt: z.string(),
});

export type SceneAnalysisOutput = z.infer<typeof SceneAnalysisSchema>;
