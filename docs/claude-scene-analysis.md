# Claude Scene Analysis

`POST /api/analyze` is the single Claude call per visualization. Claude looks at
the customer's photo and the chosen stone, and returns a machine-readable
description of the room that every renderer relies on.

Code: `server/lib/analyzers.ts`, schema `server/lib/sceneSchema.ts`, contract
`shared/scene.ts`, prompts `server/lib/prompts.ts`.

## Request to Claude

| Setting | Value | Why |
|---------|-------|-----|
| SDK | `@anthropic-ai/sdk`, `client.beta.messages.parse` | Typed structured outputs |
| Model | `claude-opus-5` (`CLAUDE_MODEL`) | Strong spatial reasoning on photos |
| Thinking | `{ type: "adaptive" }` | Geometry benefits from reasoning |
| Effort | `high` (`CLAUDE_EFFORT`) | Intelligence-sensitive task; lower it for speed/cost |
| Output | `output_config.format = betaZodOutputFormat(SceneAnalysisSchema)` | Response is guaranteed to match the schema |
| Refusal fallback | `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` | If the model declines, the API retries on a suitable fallback model inside the same call |
| `max_tokens` | 16000 | Room for thinking + a long surface list |

Content blocks, in order:

1. The room photo (≤1280 px JPEG).
2. **The same photo with a labelled 10×10 coordinate grid** (drawn server-side
   with sharp). Reading positions off the grid makes Claude's normalised
   coordinates markedly more precise.
3. The stone swatch (≤512 px) — lets Claude describe the stone concretely to
   NVIDIA Kontext, which never sees the swatch itself.
4. Text: stone name, category, tone and manufacturer description.

The system prompt (`SCENE_ANALYSIS_SYSTEM_PROMPT`) explains the coordinate
convention, which surfaces count as stone (and which never do: cabinets, tiles,
sinks, appliances…), how to order quad corners, typical counter heights, how
to estimate the camera, and how to write the two downstream prompts with
explicit "do not change" instructions (rules.md §3).

## Grounding pass — set-of-mark (`CLAUDE_GROUNDING`, default on)

Vision models are much better at recognising labelled regions than at typing
exact coordinates. In live tests the first-pass outlines were often off by
5–10 % of the frame (axis-aligned boxes over cabinets and stools), which made
the stone land in the wrong place. So after the first answer
(`server/lib/segments.ts`):

1. The photo is split into ~50 colour-coherent regions
   (Felzenszwalb–Huttenlocher graph segmentation in CIE Lab, 420 px working
   size, ~0.3 s). Region borders follow the real edges in the photo.
2. The outlines and a number per region are drawn on the photo
   (`drawSegmentOverlay`) and sent back in the same conversation with
   `groundingPrompt`. Claude answers `{"assignments":[{"surface_id","regions"}]}`.
3. For each surface, the chosen regions are filtered for colour consistency
   (regions more than ΔE 22 from the surface's dominant colour, such as a dark
   hob or floor region listed with a white top, are dropped). The union is
   cleaned with a morphological opening, and the largest piece is traced into
   the new `polygon`. The new `quad` is the largest quadrilateral inside its
   convex hull, with its corners in Claude's order, so edge 0→1 still follows
   `length_m`.
4. Any surface without usable regions keeps Claude's original geometry, and a
   failed grounding call keeps the whole first-pass result.

This costs one extra request.

## Self-check pass (`CLAUDE_REFINE_PASSES`, default 0)

Optional: the server draws Claude's polygons, quads, surface ids and back wall
on the photo (`drawSceneOverlay`) and asks Claude to correct them
(`REFINE_PROMPT`). It helped once and hurt with two passes in live tests, and
grounding supersedes it, so it is off by default. It runs before grounding.

## Anthropic-compatible gateways

The reply is parsed from text (markdown fences stripped) and validated with
zod, and the JSON Schema is also included in the prompt, so gateways that drop
`output_config` (seen with a third-party reseller in live testing) still work.
Point the SDK at one with `ANTHROPIC_BASE_URL`. Results through gateways may
differ from api.anthropic.com: the reseller tested reported ~80 input tokens
for a request containing a full photo and described the image as ~768 px wide,
which suggests it downsizes images (or is not backed by the requested model).
Region picks through it were noticeably worse than the prompt design assumes.
Use an official key for production quality.

## Output schema (abridged)

```jsonc
{
  "room_type": "kitchen",
  "summary": "…",
  "camera": { "horizontal_fov_deg": 62, "eye_height_m": 1.4, "pitch_deg": 3 },
  "back_wall": { "floor_left": {x,y}, "floor_right": {x,y}, "ceiling_left": {x,y}, "ceiling_right": {x,y} },
  "room_estimate": { "width_m": 7.5, "depth_m": 10, "ceiling_height_m": 2.9, "space_behind_camera_m": 2 },
  "colors": { "walls": "#eae8e4", "floor": "#3b2a1f", "ceiling": "#efeeea", "cabinets": "#6e4b33" },
  "surfaces": [{
    "id": "island_top", "label": "Island top", "kind": "island", "orientation": "horizontal",
    "height_m": 0.92,
    "quad": [4 points, perimeter order; edge 0→1 = length_m, edge 1→2 = depth_m],
    "polygon": [visible stone outline, excluding sinks/objects],
    "length_m": 4.2, "depth_m": 1.1, "thickness_m": 0.05
  }],
  "edit_instruction": "…for NVIDIA FLUX.1 Kontext…",
  "video_prompt": "…first-person, eye-level walkthrough for NVIDIA Cosmos…"
}
```

Coordinates are normalised to the photo (`x` 0 = left → 1 = right, `y` 0 = top →
1 = bottom) and may fall slightly outside 0–1 for corners cut off by the frame.
A complete real example lives in `tests/fixtures/kitchen-analysis.json`.

The zod schema has no numeric constraints on purpose: structured outputs
guarantee the shape, and `sanitizeScene` enforces physical ranges afterwards
(FOV 30–120°, eye height 0.5–3 m, colours `#rrggbb`, ≤16 surfaces, degenerate
quads dropped, missing polygons replaced by the quad).

## Error handling

| Situation | HTTP | `code` |
|-----------|------|--------|
| No `ANTHROPIC_API_KEY` and no `NVIDIA_API_KEY` | 503 | `NO_ANALYZER` |
| Invalid Anthropic key | 502 | `CLAUDE_AUTH` |
| Rate limited | 503 | `CLAUDE_RATE_LIMIT` |
| Other API error | 502 | `CLAUDE_API` |
| `stop_reason: "refusal"` after fallbacks | 422 | `CLAUDE_REFUSAL` |
| Truncated / unparsable output | 502 | `CLAUDE_INCOMPLETE` |

The SDK already retries 408/409/429/5xx twice. When Claude fails and
`NVIDIA_API_KEY` is set, the NVIDIA VLM analyser is tried next.

## NVIDIA VLM fallback (best effort)

When Claude is not configured or fails and `NVIDIA_API_KEY` is set,
`analyzeWithNvidiaVlm` asks the models in `NVIDIA_VLM_MODEL` (tried in order,
75 s each; default `meta/llama-3.2-90b-vision-instruct`, then
`meta/llama-3.2-11b-vision-instruct`) via
`https://integrate.api.nvidia.com/v1/chat/completions`. Llama 3.2 Vision takes
a single image, so only the gridded photo (≤896 px) is sent together with a
concrete JSON example to fill in; the reply is parsed and sanitised.

**Live test (September 2026, build.nvidia.com key):** the 90B model timed out
and the 11B model either answered in prose or timed out on the full analysis.
Treat this path as best effort — **configure `ANTHROPIC_API_KEY` for reliable
results.**

## Cost and latency

One request per visualization: three images (~1.6k tokens each at these
sizes) plus ~1.5k tokens of prompt in, and typically 2–6k tokens out including
thinking. At `high` effort expect roughly 20–60 s. Lower `CLAUDE_EFFORT` to
`medium` for faster, cheaper runs; measure the impact on surface accuracy
with a few of your own photos first.
