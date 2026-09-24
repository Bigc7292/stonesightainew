---
name: stone-processor
description: How a user's stone selection flows into the Claude + Gemini/NVIDIA pipeline.
---
# Stone Processor Skill
- Stones live in `src/stones.ts` (`STONE_DATABASE`: id, name, category, tone, description, swatchUrl).
- On "Generate", the frontend sends the room photo, the trimmed swatch (`loadSwatch`) and the stone's
  name/category/tone/description to `POST /api/analyze`.
- Claude (vision, structured outputs) returns `SceneAnalysis` (`shared/scene.ts`) including an
  `edit_instruction` that describes the stone concretely for NVIDIA FLUX.1 Kontext and a first-person
  `video_prompt` for NVIDIA Cosmos. All prompts live in `server/lib/prompts.ts` and must keep explicit
  "do not change" instructions (rules.md §3).
- AI providers: Anthropic Claude (analysis/prompts/masks), Gemini image models via an OpenAI-compatible
  gateway (photoreal countertop edit, sees the swatch), NVIDIA NIMs (optional Kontext/Cosmos).
- The edit must be SURGICAL: only existing countertops change (see `stoneEditPrompt` and the
  compositor in `server/lib/composite.ts`). Full record: `docs/PROJECT_HANDOVER.md`.
