---
name: stone-processor
description: Maps user stone selections to Vertex AI prompts using the local stone library.
---
# Stone Processor Skill
- When a user selects a stone, look up its `id` in `stoneLibrary.json`.
- Extract the `description` and `category`.
- Format the Imagen 3 inpainting prompt to emphasize the specific texture of that stone.