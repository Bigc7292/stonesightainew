# Stone Sight AI — Video Pipeline Architecture

The video generation engine runs on the **NVIDIA Cosmos 3 Super** pipeline. Video generation requires an active local or tunneled NVIDIA NIM container.

## 1. Local / Remote NVIDIA NIM Deployment (Path A)

To run Cosmos 3 Super on a machine with a compatible NVIDIA GPU (minimum 24GB+ VRAM recommended), use the following steps:

```bash
# 1. Login to NVIDIA NGC Registry
docker login nvcr.io

# 2. Spin up the Cosmos 3 Generation NIM Container
docker run -it --rm --name=cosmos3-generator-server \
  --runtime=nvidia --gpus='"device=0"' \
  -e NGC_API_KEY=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 \
  -e HF_TOKEN=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 \
  -p 8000:8000 \
  -v "$HOME/.cache/nim:/opt/nim/.cache/" \
  nvcr.io/nim/nvidia/cosmos3-generator:latest
```

Once running, update your root `.env` to point directly to the active port:

```env
COSMOS_INFERENCE_URL=http://localhost:8000/v1/infer
```

## 2. Fallback Resolution Order

1. **Local/Tunneled NIM** — If `COSMOS_INFERENCE_URL` contains `localhost`, the server attempts a direct container request first.
2. **Error State** — If the local NIM is unreachable or returns an error, the API returns a `503 Service Unavailable` with actionable guidance.

## 3. Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Conditional | Required for Path A (local NIM). |
| `COSMOS_INFERENCE_URL` | Optional | Override for local/tunneled Cosmos 3 NIM endpoint. |
