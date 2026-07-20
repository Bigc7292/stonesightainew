# Stone Sight AI — Image Pipeline Architecture (FLUX.1-Kontext-dev)

The image generation engine runs on the **NVIDIA FLUX.1-Kontext-dev** pipeline for in-photo material replacement.

## 1. Local / Remote NVIDIA NIM Deployment (Path A)

To run FLUX.1-Kontext-dev on a machine with a compatible NVIDIA GPU (minimum 24GB+ VRAM recommended):

```bash
# 1. Login to NVIDIA NGC Registry
docker login nvcr.io

# 2. Spin up the FLUX.1-Kontext-dev NIM Container
docker run -it --rm --name=flux-kontext-server \
  --runtime=nvidia --gpus='"device=0"' \
  -e NGC_API_KEY=<your-nvidia-api-key> \
  -e HF_TOKEN=<your-huggingface-token> \
  -p 8001:8000 \
  -v "$HOME/.cache/nim:/opt/nim/.cache/" \
  nvcr.io/nim/black-forest-labs/flux.1-kontext-dev:latest
```

Once running, update your root `.env` to point to the active port:

```env
FLUX_INFERENCE_URL=http://localhost:8001/v1/infer
```

## 2. Cloud Provider Fallbacks (Path B, C, etc.)

When no local NIM is configured, the server falls back to cloud providers in order:

| Priority | Provider | Endpoint | Requirements |
|----------|----------|----------|--------------|
| 1 | NVIDIA Cloud API (Preview) | `https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev` | `NVIDIA_API_KEY` — **Limited to example images only** |
| 2 | Replicate | `https://api.replicate.com/v1/predictions` | `REPLICATE_API_TOKEN` with credits |
| 3 | fal.ai | `https://fal.run/fal-ai/flux-kontext-dev` | `FAL_KEY` with credits |

**Note:** The NVIDIA Cloud API at `ai.api.nvidia.com` is a **preview endpoint** that only accepts predefined example images (`data:image/png;example_id,{0-2}`), not arbitrary user uploads. For production use with custom images, you MUST configure either:
- Local NIM container (Path A)
- Replicate with credits (Path B)
- fal.ai with credits (Path C)

## 3. Fallback Resolution Order

1. **Local/Tunneled NIM** — If `FLUX_INFERENCE_URL` contains `localhost`, the server attempts a direct container request first.
2. **NVIDIA Cloud API** — Attempts preview endpoint (will fail for custom images with 422).
3. **Replicate** — Serverless GPU with `REPLICATE_API_TOKEN` (requires credits).
4. **fal.ai** — Serverless GPU with `FAL_KEY` (requires credits).
5. **Error State** — If all providers fail, returns `503 Service Unavailable` with actionable guidance.

## 4. Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Conditional | Required for Path A (local NIM) and NVIDIA Cloud API. |
| `FLUX_INFERENCE_URL` | Optional | Override for local/tunneled FLUX NIM endpoint. |
| `REPLICATE_API_TOKEN` | Optional | Replicate serverless fallback. Requires account credits. |
| `FAL_KEY` | Optional | fal.ai serverless fallback. Requires account credits. |

## 5. Testing the Pipeline

```bash
# Set test mode to bypass auth
export MCP_TEST_MODE=true

# Start server
npm run dev

# Test image generation
curl -X POST http://localhost:5000/api/image/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Replace the stones with gold nuggets",
    "image": "<base64-or-data-url>"
  }'
```

## 6. Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `422: Expected: example_id, got: base64` | NVIDIA Cloud API preview limitation | Use local NIM or configure Replicate/fal.ai |
| `402: Insufficient credit` | Replicate/fal.ai account has no credits | Add credits at replicate.com or fal.ai |
| `503: Image generation unavailable` | All providers exhausted | Check logs for specific provider errors |
| `401: Unauthorized` | Auth middleware blocking | Set `MCP_TEST_MODE=true` in .env for dev |

## 7. Quick Start: Add Replicate Credits (2 minutes)

```bash
# 1. Go to https://replicate.com/account/billing
# 2. Add $5-10 credits (card required)
# 3. Wait 1-2 minutes for propagation
# 4. Test again - Path B will work immediately
```

**Cost:** ~$0.015-0.025/image → $5 = 200-333 generations

## 8. Persistent Dev: Brev Remote GPU Setup

```bash
# 1. Install Brev CLI
brew install brevdev/homebrew-brev/brev

# 2. Login with your token
brev login --token <your-jwt-token>

# 3. Create GPU instance (A100 40GB ~$1.30/hr)
brev open stonesight-flux --gpu a100-40gb

# 4. In Brev shell, deploy NIM
docker run -it --rm --name=flux-kontext-server \
  --runtime=nvidia --gpus='"device=0"' \
  -e NGC_API_KEY=<your-nvidia-api-key> \
  -e HF_TOKEN=<your-huggingface-token> \
  -p 8001:8000 \
  -v "$HOME/.cache/nim:/opt/nim/.cache/" \
  nvcr.io/nim/black-forest-labs/flux.1-kontext-dev:latest

# 5. Get tunnel URL
brev tunnel list stonesight-flux
# → https://xyz.tunnel.brev.dev

# 6. Update .env
FLUX_INFERENCE_URL=https://xyz.tunnel.brev.dev/v1/infer
```