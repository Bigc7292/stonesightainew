/**
 * Scene analysis: turns the customer's room photo + chosen stone into a
 * `SceneAnalysis` (see shared/scene.ts).
 *
 * Provider order:
 *   0. Claude Code analyst (CLAUDE_CODE_ANALYST=on) — a Claude Code session
 *      answers each job from a local inbox, no API key (claudeCodeAnalyst.ts).
 *   1. Anthropic Claude (vision + structured outputs) — when ANTHROPIC_API_KEY is set.
 *   2. NVIDIA-hosted VLM via the OpenAI-compatible NVIDIA API — when only
 *      NVIDIA_API_KEY is set (or Claude failed).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./env";
import { SceneAnalysisSchema } from "./sceneSchema";
import {
  SCENE_ANALYSIS_SYSTEM_PROMPT,
  sceneAnalysisUserPrompt,
  REFINE_PROMPT,
  groundingPrompt,
  type StoneInfo,
} from "./prompts";
import { sanitizeScene, type SceneAnalysis } from "../../shared/scene";
import { drawSceneOverlay, toJpeg, withCoordinateGrid } from "./images";
import { analystEnabled, analyzeWithClaudeCode } from "./claudeCodeAnalyst";
import { applyRegionAssignments, drawSegmentOverlay, segmentPhoto } from "./segments";

export type AnalyzerName = "claude-code" | "claude" | "nvidia-vlm";

export interface AnalyzeInput {
  photo: Buffer;
  swatch?: Buffer;
  stone: StoneInfo;
  /** Optional hook for evaluation tooling: receives each intermediate stage. */
  trace?: (stage: string, data: unknown) => void;
}

export interface AnalyzeResult {
  analysis: SceneAnalysis;
  analyzer: AnalyzerName;
  model: string;
}

export class AnalyzerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

export function availableAnalyzers(): AnalyzerName[] {
  const list: AnalyzerName[] = [];
  // A Claude Code session answering jobs next to the server (no API key).
  if (analystEnabled()) list.push("claude-code");
  if (config.anthropicApiKey()) list.push("claude");
  if (config.nvidiaApiKey()) list.push("nvidia-vlm");
  return list;
}

/** Prepares the three images every analyser receives. */
async function prepareImages(input: AnalyzeInput) {
  const photo = await toJpeg(input.photo, 1280, 88);
  const grid = await withCoordinateGrid(photo.buffer, photo.width, photo.height);
  const swatch = input.swatch ? (await toJpeg(input.swatch, 512, 85)).buffer : undefined;
  return { photo: photo.buffer, grid, swatch, width: photo.width, height: photo.height };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

let anthropicClient: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey(), baseURL: config.claudeBaseUrl() || undefined });
  }
  return anthropicClient;
}

type ClaudeTurn = Anthropic.Beta.BetaMessageParam;

const imageBlock = (buf: Buffer): Anthropic.Beta.BetaContentBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
});

/** One Claude request that must return a SceneAnalysis JSON object. */
const claudeScene = (messages: ClaudeTurn[]) => claudeJson(messages, SceneAnalysisSchema);

const GroundingSchema = z.object({
  assignments: z.array(z.object({ surface_id: z.string(), regions: z.array(z.number().int()) })),
});

/** One Claude request whose reply must be a JSON object matching `schema`. */
async function claudeJson<T extends z.ZodType>(messages: ClaudeTurn[], schema: T) {
  let response;
  try {
    // `create` (not `parse`): the JSON schema is still enforced by the API via
    // output_config, but we parse the reply ourselves so Anthropic-compatible
    // gateways that drop output_config or wrap JSON in markdown also work.
    response = await anthropic().beta.messages.create({
      model: config.claudeModel(),
      max_tokens: 16000,
      // Server-side refusal fallback: if the primary model declines, the API
      // re-runs the same request on a suitable fallback model automatically.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: {
        effort: config.claudeEffort(),
        format: betaZodOutputFormat(schema),
      },
      system: SCENE_ANALYSIS_SYSTEM_PROMPT,
      messages,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AnalyzerError("ANTHROPIC_API_KEY was rejected", 502, "CLAUDE_AUTH");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AnalyzerError("Claude rate limit reached — retry shortly", 503, "CLAUDE_RATE_LIMIT");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AnalyzerError(`Claude API error ${error.status}: ${error.message}`, 502, "CLAUDE_API");
    }
    throw error;
  }

  if (response.stop_reason === "refusal") {
    throw new AnalyzerError("Claude declined to analyse this photo", 422, "CLAUDE_REFUSAL");
  }
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let parsed: unknown;
  try {
    parsed = response.stop_reason === "max_tokens" ? undefined : extractJsonObject(text);
  } catch {
    parsed = undefined;
  }
  const check = parsed === undefined ? null : schema.safeParse(parsed);
  if (!check?.success) {
    console.warn("[ANALYZE] Claude reply failed validation", {
      stopReason: response.stop_reason,
      issues: check ? check.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) : "not JSON",
      sample: text.slice(0, 200),
    });
    throw new AnalyzerError("Claude returned an incomplete scene analysis", 502, "CLAUDE_INCOMPLETE");
  }
  const data = check.data as z.infer<T>;
  console.log("[ANALYZE] Claude pass complete", {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
  return { data, text, model: response.model };
}

async function analyzeWithClaude(input: AnalyzeInput): Promise<AnalyzeResult> {
  const { photo, grid, swatch, width, height } = await prepareImages(input);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: "Image 1 — the customer's room photo:" },
    imageBlock(photo),
    { type: "text", text: "Image 2 — the same photo with a coordinate grid (red vertical lines = x, cyan horizontal lines = y):" },
    imageBlock(grid),
  ];
  if (swatch) content.push({ type: "text", text: "Image 3 — swatch of the selected stone:" }, imageBlock(swatch));
  // The schema is enforced via output_config; it is repeated in the prompt so
  // gateways that drop output_config still receive the exact contract.
  content.push({
    type: "text",
    text: `${sceneAnalysisUserPrompt(input.stone)}\nReturn ONLY one JSON object (no markdown) matching this JSON Schema exactly:\n${JSON.stringify(z.toJSONSchema(SceneAnalysisSchema))}`,
  });

  let best = await claudeScene([{ role: "user", content }]);

  // Self-check passes: Claude sees its own outlines drawn on the photo and
  // corrects them. Vision models are far more precise at fixing a visible
  // overlay than at producing coordinates blind.
  for (let pass = 1; pass <= config.claudeRefinePasses(); pass++) {
    try {
      const overlay = await drawSceneOverlay(photo, width, height, sanitizeScene(best.data));
      best = await claudeScene([
        { role: "user", content },
        { role: "assistant", content: [{ type: "text", text: JSON.stringify(best.data) }] },
        {
          role: "user",
          content: [
            { type: "text", text: "Here is your analysis drawn on the photo (coloured fills = polygons, dashed = quads, labels = surface ids, white dashed = back wall, grid every 0.1):" },
            imageBlock(overlay),
            { type: "text", text: REFINE_PROMPT },
          ],
        },
      ]);
    } catch (error) {
      console.warn(`[ANALYZE] Claude refinement pass ${pass} failed; keeping previous result`, {
        message: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  let analysis = sanitizeScene(best.data);
  input.trace?.("claude", analysis);

  // Grounding pass (set-of-mark): Claude picks numbered photo regions for
  // each surface and the outlines are rebuilt from them, so they follow the
  // real edges instead of Claude's approximate coordinates.
  if (config.claudeGrounding() && analysis.surfaces.length > 0) {
    try {
      const seg = await segmentPhoto(photo);
      const marked = await drawSegmentOverlay(photo, width, height, seg);
      input.trace?.("segments", { image: marked, count: seg.count });
      const ids = analysis.surfaces.map((s) => s.id);
      const grounding = await claudeJson(
        [
          { role: "user", content },
          { role: "assistant", content: [{ type: "text", text: JSON.stringify(best.data) }] },
          {
            role: "user",
            content: [imageBlock(marked), { type: "text", text: groundingPrompt(ids, seg.count) }],
          },
        ],
        GroundingSchema,
      );
      input.trace?.("grounding", grounding.data);
      const applied = applyRegionAssignments(analysis, grounding.data.assignments, seg);
      analysis = applied.scene;
      console.log("[ANALYZE] Grounded surfaces", { regions: seg.count, updated: applied.updated });
    } catch (error) {
      console.warn("[ANALYZE] Grounding pass failed; keeping Claude's outlines", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { analysis, analyzer: "claude", model: best.model };
}

// ---------------------------------------------------------------------------
// NVIDIA VLM (OpenAI-compatible chat completions on integrate.api.nvidia.com)
// ---------------------------------------------------------------------------

/** Extracts the first top-level JSON object from free-form model text. */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in response");
  return JSON.parse(candidate.slice(start, end + 1));
}

const NVIDIA_VLM_EXAMPLE = JSON.stringify({
  room_type: "kitchen",
  summary: "One sentence about the room",
  camera: { horizontal_fov_deg: 65, eye_height_m: 1.55, pitch_deg: -8 },
  back_wall: {
    floor_left: { x: 0.3, y: 0.62 },
    floor_right: { x: 0.8, y: 0.62 },
    ceiling_left: { x: 0.3, y: 0.3 },
    ceiling_right: { x: 0.8, y: 0.3 },
  },
  room_estimate: { width_m: 4.5, depth_m: 5, ceiling_height_m: 2.6, space_behind_camera_m: 1.5 },
  colors: { walls: "#e8e4dc", floor: "#8a7560", ceiling: "#f1efeb", cabinets: "#d9d4cc" },
  surfaces: [
    {
      id: "island_top",
      label: "Island top",
      kind: "island",
      orientation: "horizontal",
      height_m: 0.92,
      quad: [{ x: 0.2, y: 0.6 }, { x: 0.7, y: 0.58 }, { x: 0.8, y: 0.66 }, { x: 0.25, y: 0.7 }],
      polygon: [{ x: 0.2, y: 0.6 }, { x: 0.7, y: 0.58 }, { x: 0.8, y: 0.66 }, { x: 0.25, y: 0.7 }],
      length_m: 2.8,
      depth_m: 1,
      thickness_m: 0.03,
    },
  ],
  edit_instruction: "Instruction for the image editor",
  video_prompt: "First-person eye-level walkthrough prompt",
});

/** One chat-completion call to an NVIDIA-hosted VLM; returns the raw reply text. */
async function nvidiaVlmCall(model: string, gridPhoto: Buffer, prompt: string): Promise<string> {
  const res = await fetch(`${config.nvidiaBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.nvidiaApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        { role: "system", content: SCENE_ANALYSIS_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            // Llama 3.2 Vision on NVIDIA accepts a single image, so only the
            // gridded photo is sent; the swatch is described in text.
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${gridPhoto.toString("base64")}` } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
    // Hosted VLMs can queue; fail over to the next model instead of hanging.
    signal: AbortSignal.timeout(75_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AnalyzerError(`NVIDIA VLM ${model} failed with status ${res.status}: ${text.slice(0, 300)}`, 502, "NVIDIA_VLM_API");
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

async function analyzeWithNvidiaVlm(input: AnalyzeInput): Promise<AnalyzeResult> {
  // Inline images must stay small (~180 KB) for hosted NVIDIA functions.
  const photo = await toJpeg(input.photo, 896, 80);
  const grid = await withCoordinateGrid(photo.buffer, photo.width, photo.height);
  // Smaller open models follow a concrete example far better than a long JSON Schema.
  const prompt = [
    "The image is the customer's room photo with a labelled coordinate grid (red vertical lines = x, cyan horizontal lines = y). There is no swatch image; rely on the stone description.",
    sceneAnalysisUserPrompt(input.stone),
    "Reply with ONE JSON object in exactly this structure (replace every value with your measurements; list every stone surface):",
    NVIDIA_VLM_EXAMPLE,
    "Your reply must start with { and end with }. No prose, no markdown, no code.",
  ].join("\n");

  let lastError: unknown;
  for (const model of config.nvidiaVlmModels()) {
    try {
      const text = await nvidiaVlmCall(model, grid, prompt);
      let parsed: unknown;
      try {
        parsed = extractJsonObject(text);
      } catch {
        console.warn("[ANALYZE] NVIDIA VLM reply was not JSON", { model, sample: text.slice(0, 300) });
        throw new AnalyzerError(`NVIDIA VLM ${model} did not return JSON`, 502, "NVIDIA_VLM_FORMAT");
      }
      // Validate the shape loosely — sanitizeScene repairs ranges and defaults.
      const check = SceneAnalysisSchema.safeParse(parsed);
      if (!check.success) {
        console.warn("[ANALYZE] NVIDIA VLM output deviated from schema; sanitising", {
          model,
          issues: check.error.issues.slice(0, 5).map((i) => i.path.join(".")),
        });
      }
      return { analysis: sanitizeScene(parsed), analyzer: "nvidia-vlm", model };
    } catch (error) {
      lastError = error;
      console.warn("[ANALYZE] NVIDIA VLM model failed, trying next", {
        model,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw lastError instanceof Error ? lastError : new AnalyzerError("NVIDIA VLM analysis failed", 502, "NVIDIA_VLM_API");
}

// ---------------------------------------------------------------------------

export async function analyzeScene(input: AnalyzeInput): Promise<AnalyzeResult> {
  const analyzers = availableAnalyzers();
  if (analyzers.length === 0) {
    throw new AnalyzerError(
      "No scene analyser configured. Set ANTHROPIC_API_KEY (recommended) or NVIDIA_API_KEY.",
      503,
      "NO_ANALYZER",
    );
  }
  let lastError: unknown;
  for (const name of analyzers) {
    try {
      if (name === "claude-code")
        return { analysis: await analyzeWithClaudeCode(input.photo, input.stone), analyzer: name, model: "claude-code-session" };
      return name === "claude" ? await analyzeWithClaude(input) : await analyzeWithNvidiaVlm(input);
    } catch (error) {
      lastError = error;
      console.error(`[ANALYZE] ${name} failed`, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw lastError instanceof AnalyzerError
    ? lastError
    : new AnalyzerError(
        lastError instanceof Error ? lastError.message : "Scene analysis failed",
        502,
        "ANALYZE_FAILED",
      );
}
