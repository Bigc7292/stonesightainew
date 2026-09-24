---
name: stone-processor
description: How a user's stone selection flows into the Claude + NVIDIA pipeline.
---
# Stone Processor Skill
- Stones live in `src/stones.ts` (`STONE_DATABASE`: id, name, category, tone, description, swatchUrl).
- On "Generate", the frontend sends the room photo, the trimmed swatch (`loadSwatch`) and the stone's
  name/category/tone/description to `POST /api/analyze`.
- Claude (vision, structured outputs) returns `SceneAnalysis` (`shared/scene.ts`) including an
  `edit_instruction` that describes the stone concretely for NVIDIA FLUX.1 Kontext and a first-person
  `video_prompt` for NVIDIA Cosmos. All prompts live in `server/lib/prompts.ts` and must keep explicit
  "do not change" instructions (rules.md §3).
- Only Anthropic Claude and NVIDIA are allowed as AI providers.
