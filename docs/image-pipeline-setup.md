# Image Pipeline — Claude + Gemini image (or NVIDIA FLUX.1 Kontext)

The static image is produced in two stages:

1. **Claude** locates every existing countertop and writes the edit instruction
   (see [claude-scene-analysis.md](claude-scene-analysis.md)).
2. A photoreal editor surgically replaces the countertops:
   - **Gemini image models** (default) through an OpenAI-compatible gateway —
     `IMAGE_EDIT_BASE_URL`, `IMAGE_EDIT_API_KEY`, optional `IMAGE_EDIT_MODELS`
     (default `gemini-3.1-flash-image,gemini-3-pro-image-preview,gemini-2.5-flash-image`,
     tried in order with retries on 503/429). Gemini also receives the **stone
     swatch image**, and the prompt is `stoneEditPrompt` in `server/lib/prompts.ts`.
   - or **NVIDIA FLUX.1 Kontext** when a self-hosted NIM is set (`FLUX_INFERENCE_URL`,
     tried first) — details below.

   The server then **aligns** the edit to the original photo and **composites only
   the new countertops** back (`server/lib/composite.ts`), so the rest of the room
   is pixel-identical. An edit the editor reframed is retried once, then the app
   falls back to the local renderer. See [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md)
   for measured results and the prompt history.

If no NVIDIA image endpoint is reachable, the browser renders the stone itself
from Claude's surface map (perspective-correct swatch mapping with the photo's
lighting). Both paths are covered by `npm run test:e2e`.

> The previous implementation defaulted to `flux.1-dev`, a **text-to-image**
> model that ignores the uploaded photo — that is why it "generated a
> completely different looking room". The fal.ai/Replicate fallbacks have been
> removed; only NVIDIA endpoints are used.

## Endpoint resolution (`server/lib/imageEditor.ts`)

| Order | Endpoint | Enabled when |
|-------|----------|--------------|
| 1 | Self-hosted / tunnelled Kontext NIM at `FLUX_INFERENCE_URL` | variable set |
| 2 | NVIDIA-hosted Kontext `https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev` (override `NVIDIA_IMAGE_EDIT_URL`) | `NVIDIA_API_KEY` set and `NVIDIA_HOSTED_IMAGE` ≠ `false` |

Request body (both):

```json
{ "prompt": "<Claude edit_instruction>", "image": "data:image/jpeg;base64,…",
  "aspect_ratio": "match_input_image", "steps": 30, "cfg_scale": 3.5, "seed": 123 }
```

- The photo is resized to ≤1024 px (Kontext's native ~1 MP).
- Hosted calls larger than ~180 KB upload the image as an **NVCF asset** and
  send `data:image/jpeg;asset_id,<id>` with the `NVCF-INPUT-ASSET-REFERENCES`
  header.
- Hosted calls that answer `202 Accepted` are polled at
  `https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/<NVCF-REQID>`.
- Accepted response shapes: `artifacts[0].base64`, `data[0].b64_json`,
  `image`, `images[0]`, `b64_output`, `outputs[0]`.
- **Hosted endpoints are example-only.** Live test (September 2026,
  build.nvidia.com key): hosted FLUX.1 Kontext, FLUX.2 Klein and FLUX.1-dev
  (depth mode) all return `422 Expected: example_id` for customer photos, both
  inline (`got: base64`) and as NVCF assets (`got: asset_id`); only NVIDIA's
  built-in example images are accepted. The server detects this once, logs a
  warning and stops calling the hosted endpoint. **For NVIDIA edits of real
  photos, deploy the Kontext NIM (below) and set `FLUX_INFERENCE_URL`.** Until
  then the Claude-guided renderer produces the image.

## Deploying the Kontext NIM (recommended)

Needs an NVIDIA GPU with ≥24 GB VRAM (L40S, A100, H100, RTX 4090/5090…).

```bash
docker login nvcr.io            # username: $oauthtoken, password: <your NGC API key>

docker run -it --rm --name=flux-kontext \
  --runtime=nvidia --gpus='"device=0"' \
  -e NGC_API_KEY=<your-ngc-api-key> \
  -e HF_TOKEN=<your-huggingface-token> \
  -p 8001:8000 \
  -v "$HOME/.cache/nim:/opt/nim/.cache/" \
  nvcr.io/nim/black-forest-labs/flux.1-kontext-dev:latest
```

Then in `.env`:

```env
FLUX_INFERENCE_URL=http://<gpu-host>:8001/v1/infer
```

Remote GPU options:

- **NVIDIA Brev**: `brev open stonesight-flux --gpu a100-40gb`, run the container
  above, then `brev tunnel list stonesight-flux` and set
  `FLUX_INFERENCE_URL=https://<tunnel>/v1/infer`.
- **Colab (experimental)**: `flux_nim_colab.ipynb` starts the NIM with ngrok on a
  Colab GPU; set `FLUX_INFERENCE_URL` to the ngrok URL + `/v1/infer`.

Verify with `npm run check:providers`, then:

```bash
curl -X POST http://localhost:5000/api/image/generate \
  -H "Content-Type: application/json" -H "Authorization: Bearer <supabase-token>" \
  -d '{"prompt":"Replace the countertop with white marble","image":"data:image/jpeg;base64,…"}'
```

## Compositing and local rendering (`src/render/stoneRenderer.ts`)

| Function | What it does |
|----------|--------------|
| `compositeEdit(photo, edited, scene)` | Union of Claude's surface polygons, dilated by 1.2 % and feathered 0.6 % of the long side; original pixels outside, NVIDIA pixels inside |
| `renderStone(photo, swatch, scene)` | For each surface: homography from the slab's unit square to its quad, swatch sampled in metres (0.9 m per tile, mirrored repeat), lighting = blurred luminance ratio × exposure + specular highlights, soft polygon mask |
| `loadSwatch(url)` | Trims uniform white/black catalogue margins before texturing |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Rendered with StoneSight renderer" although NVIDIA is set up | Kontext call failed — see the notice on the results page and `[IMAGE]` server logs | Check `FLUX_INFERENCE_URL`, container logs, `npm run check:providers` |
| `422 Expected: example_id` in logs | Hosted preview only accepts example images | Deploy the NIM and set `FLUX_INFERENCE_URL` |
| `401` from NVIDIA | `NVIDIA_API_KEY` invalid/expired | Create a new key at build.nvidia.com |
| Stone misses part of a counter | Claude's polygon was too small | Regenerate; use a wider, well-lit, uncluttered photo |
| `NVIDIA_IMAGE_UNAVAILABLE` (503) | No NVIDIA image endpoint configured | Expected in Claude-only mode — the browser renders locally |
